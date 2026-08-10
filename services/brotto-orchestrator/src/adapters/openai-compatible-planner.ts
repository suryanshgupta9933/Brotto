/**
 * OpenAI-compatible inference planner adapter.
 *
 * Implements InferencePort for OpenAI-compatible endpoints (Ollama, LM Studio,
 * Azure OpenAI, vLLM, etc.) using SSE streaming.
 */

import { AgentProposalV1Schema } from '@brotto/brotto-action-schema';
import type {
  ActionProposalV1,
  CompletionProposalV1,
  ObservationV1,
} from '@brotto/brotto-action-schema';
import {
  InferenceContractError,
  type InferencePort,
  type PlanningInput,
  type PlanningOutcome,
} from '../engine/types.js';
import { buildToolSchemas } from '../prompts/tool-schemas.js';
import { ToolCallParser, type FaraToolCall } from '../parser.js';
import { validateMemoryUpdates, validateMemoryUpdatesForGoal } from '../context/decision.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  maxTokens?: number;
  temperature?: number;
  transport?: typeof fetch;
}

export class OpenAICompatiblePlannerError extends InferenceContractError {
  override readonly name = 'OpenAICompatiblePlannerError';
  override readonly code = 'INFERENCE_CONTRACT_ERROR';

  constructor(message: string, retryable: boolean) {
    super(message, retryable);
  }
}

/** SSE streaming chunk from OpenAI /chat/completions */
interface SseChunk {
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

export class OpenAICompatiblePlanner implements InferencePort {
  private readonly transport: typeof fetch;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.transport = config.transport ?? fetch;
  }

  async plan(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome> {
    // ponytail: insert /chat/completions BEFORE any query string so Azure's
    // api-version param doesn't get clobbered. (baseUrl might already end in
    // ?api-version=...)
    const base = this.config.baseUrl.replace(/\/$/, "");
    const qIdx = base.indexOf("?");
    const url = qIdx >= 0
      ? `${base.slice(0, qIdx)}/chat/completions${base.slice(qIdx)}`
      : `${base}/chat/completions`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    if (this.config.apiKey) {
      const header = this.config.apiKeyHeader ?? 'authorization';
      // apiKeyPrefix only applies to the default "authorization" header;
      // custom headers (e.g. "api-key" for Azure) carry the raw key.
      const prefix =
        this.config.apiKeyHeader !== undefined
          ? (this.config.apiKeyPrefix ?? '')
          : (this.config.apiKeyPrefix ?? 'Bearer ');
      headers[header] = `${prefix}${this.config.apiKey}`;
    }

    // ponytail: gpt-5/o-series quirks (per OpenAI gpt-5 migration guide):
    //   - max_tokens → use max_completion_tokens (or omit)
    //   - temperature → must be 1 or omit (default)
    //   - reasoning_effort → function tools on /v1/chat/completions
    //     require reasoning_effort="none" (non-reasoning fallback). The
    //     alternative is switching to /v1/responses — a bigger refactor.
    //   - tool_choice: "required" for gpt-5 family — forces the model to
    //     emit a tool call (terminate is the escape hatch) instead of
    //     dumping structured intent as prose. gpt-5 with reasoning_effort
    //     = "none" sometimes narrates its tool call into content rather
    //     than invoking it.
    const isReasoningFamily = /^(gpt-5|o[1-9])/i.test(this.config.model);
    const body = JSON.stringify({
      model: this.config.model,
      messages: this.buildMessages(input),
      tools: buildToolSchemas(),
      tool_choice: isReasoningFamily ? 'required' : 'auto',
      stream: true,
      ...(isReasoningFamily ? { reasoning_effort: 'none' as const } : {}),
    });

    let response: Response;
    try {
      response = await this.transport(url, {
        method: 'POST',
        headers,
        body,
        signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw e;
      }
      throw new OpenAICompatiblePlannerError(
        `Request failed: ${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text().catch(() => "<no body>");
      // ponytail: capture OpenAI's Retry-After hint (in ms) on 429 so the caller
      // backs off for the full TPM window instead of guessing. Default 1000.
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Math.max(1000, Number(retryAfterHeader) * 1000 || 1000) : 1000;
      const err = new OpenAICompatiblePlannerError(
        `HTTP ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
        retryable,
      );
      (err as { retryAfterMs?: number }).retryAfterMs = retryAfterMs;
      throw err;
    }

    if (!response.body) {
      throw new OpenAICompatiblePlannerError('Response body is null', false);
    }

    const completion = await this.readSseStream(response.body, signal);

    const choices = completion.choices;
    if (!choices || choices.length === 0) {
      throw new OpenAICompatiblePlannerError('Response has empty choices array', false);
    }

    const choice = choices[0];
    const raw_tool_calls = choice.delta?.tool_calls ?? [];
    console.log(`[planner] assembled tool_calls:`, JSON.stringify(raw_tool_calls));
    // ponytail: filter empty-named tool calls. Streaming assembly can leave
    // the name blank if no chunk supplied one (rare but seen with gpt-4o-mini).
    const tool_calls = raw_tool_calls.filter((tc) => (tc.function?.name ?? "").length > 0);

    if (tool_calls.length > 0) {
      return this.buildActionProposal(input, tool_calls);
    }

    const content = choice.delta?.content ?? '';
    if (!content) {
      // ponytail: model returned nothing actionable. Treat as a question so the
      // loop continues instead of crashing the demo. Better fix: stronger model.
      return {
        kind: 'question',
        observationId: input.observation.observationId,
        question: 'I need to think about this. Please provide the next observation so I can decide.',
        choices: undefined,
      };
    }
    // ponytail: prose with no tool call is NOT a completion. The earlier path
    // converted any non-empty content into CompletionProposalV1, which the
    // local driver treats as task success — a model that narrates "I need to
    // sign in" or "let me summarise" without calling terminate would falsely
    // close the loop. Force a corrective question instead. The local driver
    // counts consecutive prose-only responses and fails loudly after 2 so the
    // user sees what the model is doing instead of a phantom success.
    const prosePreview = content.length > 240 ? `${content.slice(0, 240)}…` : content;
    return {
      kind: 'question',
      observationId: input.observation.observationId ?? (crypto.randomUUID() as never),
      question: `Your last response was prose without a tool call ("${prosePreview}"). Either call a real action (visit_url, left_click, terminate, etc.) or call terminate(finalAnswer=<your answer>) to commit a final report. Prose-only responses do not end the task.`,
      choices: undefined,
    };
  }

  private buildMessages(input: PlanningInput): Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> {
    const messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> = [];

    messages.push({
      role: 'system',
      content: [
        "You are Brotto, the user's SHADOW BROWSER. You are not a separate AI — you are the user's hands on their own browser. The user is sitting next to you (metaphorically) watching their screen; you see exactly what they see, and your clicks land on their browser, in their session, with their cookies. When the user says 'go to gmail and find my Amazon package', you are operating their browser in real time.",
        "",
        "Identity and tone (strict):",
        "- Speak about the user in third person: 'the user', 'their account', 'the user's request'. Never use 'my', 'your', 'I have my account', 'your GitHub'. You are a separate agent acting on the user's behalf, not the user themselves.",
        "- Speak about yourself in first person when explaining your reasoning ('I see…', 'I will click…') — that is normal reasoning, not identity.",
        "- In the `reasoning` field (which the user reads in the side panel), keep identity-neutral phrasing: 'Navigating to the GitHub profile so I can read the follower count.' not 'Going to MY GitHub profile'.",
        "- If the user asks for personal/private data (their inbox, account settings, payments), and the page is logged out, you can NEVER reach it alone — the harness pauses, the user signs in, and you observe the post-login page. NEVER invent account data.",
        "",
        "MINDSET (this is the most important section):",
        "- You are a HUMAN POWER USER of the user's browser, sitting at their desk. Act like one.",
        "- A human would NEVER click the same button twice expecting a different result. If a click doesn't change the page, they pivot immediately — type into the input, navigate directly, scroll, or pick a different control.",
        "- A human would NEVER answer a question from a list of items without identifying the SPECIFIC item the user asked about. 'Order delivered' is not a valid answer unless you can point to the order ID and link it to the user's request.",
        "- A human would NEVER terminate a task with a vague date or number. They would cite the order ID, tracking ID, transaction ID, or URL that proves the answer.",
        "- A human would USE the search bar (type → Enter) far more often than click around. Type is almost always faster than click.",
        "",
        "Loop: read the page context (URL + PAGE TEXT first, then INTERACTIVE ELEMENTS + WORKING MEMORY) → identify the current stage and what to do next → call one tool → re-read context → repeat. Call terminate(finalAnswer) ONLY when you have found the answer in the page text AND can cite it specifically.",
        "",
        "THINK BEFORE EACH ACTION (mandatory, 1 sentence in `reasoning`):",
        "1. What am I trying to accomplish right now toward the user's goal? Which sub-step is this?",
        "2. What does the CURRENT observation tell me — what changed, what's present, what's missing? Don't act on stale assumptions from a previous step.",
        "3. Will this action plausibly advance the goal? If not, pick a different action or stop.",
        "Do NOT skip this reasoning. The same reasoning field that satisfies the schema is also your scratchpad — write what you're actually thinking, not a generic 'navigating' filler.",
        "",
        "CRITICAL RULE: STAGNATION & ACTION REJECTION ENFORCEMENT:",
        "- Read the RECENT STEPS & VERIFIED OUTCOMES section in the prompt carefully.",
        "- If a step outcome shows '[Unchanged: URL and page state remained identical]' or '[REJECTED BY HARNESS]' → your previous action HAD NO EFFECT OR WAS REJECTED.",
        "- IT IS STRICTLY FORBIDDEN TO REPEAT THE SAME URL OR CLICK COORDINATE AFTER AN [Unchanged] OR [REJECTED] OUTCOME. The harness will hard-reject your action and fail the run.",
        "- When an action is unchanged or rejected, YOU MUST PIVOT IMMEDIATELY: try direct URL parameterization (e.g. adding `?sort=stargazers` or `?type=source`), scroll down to reveal more items, or click a completely different element ID.",
        "- If the rejected click was on a search/filter INPUT (not a button), the input likely has focus now — your next action must be `insert_text` to type the query, not another click on the same input.",
        "",
        "GENERALIZED WEB NAVIGATION & DATA EXTRACTION PATTERNS:",
        "- Prefer Direct URL Query Parameters: On data-heavy websites (GitHub, Amazon, eBay, Reddit, Jira, Google), URL query parameters like `?tab=repositories&type=source&sort=stargazers`, `?sort=stars`, `?q=query` are 10x faster and more reliable than UI dropdown clicks.",
        "- Account Scope Awareness (User vs Organization/Workspace): Distinguish clearly between personal user accounts (`/username`) and organization/workspace accounts (`/orgs/name`, `/w/name`). Personal repos are owned directly by the user (`username/reponame`). Repositories owned by an organization (`orgname/reponame`) are NOT personal repos.",
        "- Working Memory Recording: Whenever you observe key data requested by the goal (e.g. repository names, star counts, order statuses, prices, tracking numbers, the user's own order IDs), YOU MUST RECORD IT via `memoryUpdates: [{ key: '...', value: '...', evidence: '...' }]` on your tool call so it is permanently preserved across turns. Record identifiers as soon as you see them — they are the proof you cite in the finalAnswer.",
        "- Tie finalAnswer to a SPECIFIC identifier: before terminating, ask yourself 'which exact order ID / repo name / tracking number answers this question?' and cite it. 'Delivered 6 August' alone is not an answer to 'status of my Amazon package' — you need the order ID and either a tracking URL or a status page URL.",
        "",
        "CRITICAL: Do NOT terminate just because you navigated somewhere. The user asked a question that requires you to FIND an answer on the page. Terminating after navigation without extracting the answer FAILS the task. Your finalAnswer must be a value you actually saw in the page text, not a guess or summary of what you did.",
        "",
        "MANDATORY on every tool call: include a `reasoning` field — one short plain-English sentence describing what you observe NOW (different from previous steps) and what you're doing. The user sees this sentence in the side panel. The reasoning must evolve across steps.",
        "",
        "MANDATORY on terminate: include `finalAnswer` — the actual answer to the user's original question in plain English, with supporting facts the user needs.\n",
        "The finalAnswer MUST include, in this order:\n",
        "  (1) A direct answer to the user's original question (one short sentence that names the specific entity — order ID, repo name, etc.).\n",
        "  (2) Supporting facts you actually saw on the page — URLs visited, tracking IDs / order numbers / dates / courier names / entity names that ground the answer. Pull these from working memory or page text.\n",
        "  (3) An uncertainty flag IF applicable: 'could not find X' or 'Y might be outdated'.\n",
        "If the user asked about a SPECIFIC entity (their package, their repo, their order) and your finalAnswer doesn't reference that entity's identifier, the answer will be rejected as too vague.\n",
        "",
        "Rules:",
        "- NEVER ask the user for credentials (passwords, 2FA codes, OAuth tokens, API keys, etc.).",
        "- GitHub Shortcut: When asked for a user's most starred personal repo, immediately navigate to `https://github.com/<username>?tab=repositories&type=source&sort=stargazers`. Note that `type=source` filters out organization repos, and `sort=stargazers` puts the most starred personal repo at the top.",
        "- Personal vs Org Repositories: NEVER return an organization repo (e.g. `orgname/reponame`) as a personal repo. Only repos owned directly by the user (`username/reponame`) count as personal repos.",
        "- Search Bar Directive: On search-enabled web applications (Gmail, Amazon, Outlook, GitHub, Slack, Jira, e-commerce stores), ALWAYS prioritize using the Search Bar. Type → Enter. Or use a direct search URL. Don't click sidebar category links when a search bar is visible.",
        "- Inputs & Typing: Clicking a text input (like a search bar) only gives it focus. The page state will NOT change (outcome will say '[Unchanged]'). THIS IS EXPECTED. Your NEXT action must be `insert_text` to type the query — never click the same input again.",
        "- When clicking a search bar, after the click (which only focuses), you must immediately insert_text and press Enter. The 3-step sequence is: click → insert_text → key('Enter'). Skipping the insert_text step leaves the search empty.",
        "- Grounded Answers: NEVER call terminate with a guess or unverified summary. Your finalAnswer MUST cite the specific identifier (order ID, tracking ID, repo URL, etc.) AND the specific fact (status, count, name) seen on the page. Vague claims without identifiers will be rejected.",
        "- Visited Links: Do NOT click a link or navigate to a URL that you already visited in history.",
        "- Dropdowns & Menus: Left-clicking an element marked `(haspopup=...)` or `(expanded=false)` opens a menu/popover. After clicking it, read the NEW interactive elements list in the next context to select the menu item.",
        "- insert_text types into the currently focused element only. If the field you want is NOT marked focused=true, left_click it first.",
        "- Do NOT call wait. The harness waits between actions automatically.",
        "- Do NOT call ask_user_question for routine navigation. Use it ONLY when the goal is genuinely ambiguous.",
        "- CLICK BY ELEMENT ID, NOT BY PIXELS: Every click tool accepts a `targetId` field. The `=== INTERACTIVE ELEMENTS ===` block in your context shows bracketed ids like `[f377c754f377c754]` — pass that string as `targetId`. The harness resolves it to the element's center. Pixel coordinates (`x`, `y`) are a fallback for canvas / drawn content that does not appear in INTERACTIVE ELEMENTS — DO NOT use them when an element id is visible. Clicking at guessed coordinates almost always misses the target.",
        "",
        "EMAIL TYPE DISCRIMINATION (Gmail / Outlook / order-status tasks):",
        "- When the user asks about a PACKAGE or ORDER STATUS, the right email is a DELIVERY / SHIPPING notification, not a payment confirmation.",
        "- DELIVERY email subject keywords: 'Delivered', 'Shipped', 'Out for delivery', 'Dispatched', 'In transit', 'Arriving', 'Tracking ID', 'Estimated delivery', 'Order shipped'. Body contains a status phrase ('Delivered on …', 'Tracking ID …').",
        "- PAYMENT-ONLY email subject keywords: 'Rs X paid on Amazon', 'Payment successful', 'Order placed', 'Order confirmed', 'Refund', 'Cashback', 'Your order has been placed'. Body contains an amount but NO shipping status.",
        "- A payment email has the order ID but NOT the package status. NEVER terminate after opening a payment email — keep searching for the delivery notification.",
        "- For Gmail searches, use delivery-specific operators instead of broad `from:amazon.com`: `from:amazon subject:(delivered OR shipped OR tracking)`, or `from:amazon \"out for delivery\"`, or `from:amazon \"tracking id\"`. These narrow the result list to actual delivery emails.",
        "- After clicking a search result, verify in the page text that the email body contains a delivery status phrase ('Delivered …', 'Tracking ID …'). If it only mentions payment/amount, go back and click the next result instead of terminating.",
        "",
        "DOMAIN VERIFICATION (when the user names a specific seller / site):",
        "- When the user says 'my Amazon package', 'my Flipkart order', 'my Uber ride', etc., the named entity is the GOAL DOMAIN. Every action — opening an email, clicking a link, recording memory — must be grounded on data FROM that domain.",
        "- Do NOT open an email or click a link whose sender or hostname does not match the goal domain. ANY other seller is suspect, regardless of how relevant the subject line looks. 'Other shipping email' is NEVER 'the user's Amazon package' just because the words 'order' or 'shipping' appear.",
        "- When the rendered context includes an === INBOX ROWS === table, use the sender column to filter BEFORE clicking. Skip rows whose sender doesn't match the goal domain — do NOT open them to 'check if they're relevant'.",
        "- If you cannot find a matching email after scanning the visible inbox, your next action must be a DOMAIN-SPECIFIC search (e.g. `from:amazon subject:(delivered OR shipped OR tracking)`), not more inbox browsing.",
        "",
        "SEARCH-FIRST (when the user names a domain + topic):",
        "- If the goal names a specific domain (Amazon, GitHub, Flipkart, Jira, etc.) AND a topic ('my package', 'my repo', 'my order'), the FIRST action should almost always be a direct search URL on that domain, not inbox / list browsing.",
        "- Examples:",
        "  - Amazon package → visit_url('https://www.amazon.in/gp/your-account/order-history') or Gmail search 'from:amazon subject:(delivered OR shipped OR tracking)'.",
        "  - GitHub starred repos → visit_url('https://github.com/<user>?tab=repositories&sort=stars').",
        "  - Jira ticket → visit_url('https://<org>.atlassian.net/browse/<KEY>') if a key is mentioned.",
        "- Direct search URLs bypass the inbox-row-selection failure mode entirely. Only browse the inbox / list when the goal has no specific domain or when the direct URL is unknown.",
        "",
        "ROW CONTAINER vs INNER LINK (email / list pages):",
        "- List rows in Gmail, Outlook, Yahoo, Proton, and similar list views often have role=\"link\" on the OUTER row div, but the click handler is on an INNER element: the message subject line, a 'View order' / 'Track package' / 'Open' / 'View details' button, or another named link inside the row.",
        "- Clicking the row CONTAINER dispatches a click but the page does NOT navigate. The harness confirms the click happened, but the page stays on the same list.",
        "- To open a list item, click an INNER element — prefer a named action button (View order, Open, Track) when present, otherwise the subject line / message title link. The bbox center of the row container is at the same Y as the action button — almost-but-not-quite aligned — so picking the row container looks reasonable but doesn't work.",
        "- Heuristic: if a click produces no URL change and no title change for 2 consecutive turns, your click target was probably a row container — switch to a child element.",
        "",
        "DRILL INTO DEEPER SOURCE OF TRUTH (general):",
        "- The page you're on is almost never the answer. List pages (search results, email inbox, GitHub repo list, e-commerce catalog, doc index, news feed) show SUMMARIES — titles, snippets, brief metadata. The actual answer (full text, live status, current values, source code, image, etc.) lives on the DETAIL page for the item you care about.",
        "- After finding an item that matches the goal, look for a 'drill in' affordance BEFORE terminating: a link with text like 'View', 'View details', 'Open', 'Read more', 'Source', 'Track', 'View order', 'Inspect', or any link whose href points to a more specific URL (item detail page, tracking page, issue body, file viewer, status page).",
        "- The rendered context surfaces these as the `=== ANCHORS (text → href) ===` block. Scan it for any anchor whose text or href suggests the source-of-truth detail page. visit_url(<href>) directly if the URL is in the anchor list; left_click the inner link if the link has a stable element id.",
        "- When does this apply? Anytime the page you're on summarizes but doesn't authoritatively answer. Email body for tracking: drill into the courier tracking page. GitHub repo card: drill into the repo's main page or file viewer. Search result snippet: drill into the result. News headline: drill into the article. Doc section index: drill into the actual section.",
        "- When does this NOT apply? If the page text already contains the user's required identifier (status, order ID, current location, full body, exact value), terminate. Don't drill for the sake of drilling.",
        "- Self-check before terminating: did I land on the SOURCE OF TRUTH (the actual page the user wants to read) or on a LIST / SUMMARY page? If summary, find and visit the deeper page.",
        "",
        "MEMORY DISCIPLINE (model-emitted memoryUpdates):",
        "- memoryUpdates are a CLAIM, not a fact. The harness will REJECT updates whose value/evidence doesn't reference any goal keyword (e.g. 'amazon', 'package') AND isn't in an always-crucial category (tracking_id, order_id, amount_*, status, event_date, delivered_date, sender).",
        "- Before each turn, re-read WORKING MEMORY. If any fact's sender/domain contradicts the goal (e.g. SOCKENUP.IN memory under an Amazon goal), discard it mentally and re-derive from the current page text.",
        "- Never let a stale memory fact override a fresh page observation. The page is the source of truth; memory is a working summary.",
      ].join("\n"),
    });




    // ponytail: harness provides pre-rendered context (stable IDs, diff, inline
    // coords). Use it verbatim. Fall back to building from raw observation if no
    // harness context provided (e.g. when called from orchestrator directly).
    const ctx = (input as { context?: string }).context;
    const screenshot = (input as { screenshot?: string }).screenshot;
    if (ctx) {
      const text = `Goal: ${input.goal}\n\n${ctx}`;
      if (screenshot) {
        // ponytail: multi-content message for vision-capable models. Screenshot
        // comes AFTER the text so the model reads the structured context first,
        // then grounds coords against the image. Default OFF — set DEMO_VISION=1.
        const content = [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot}` } },
        ] as Array<{ type: string; text?: string; image_url?: { url: string } }>;
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: text });
      }
    } else {
      const targets = (input.observation.semanticTargets ?? []).filter((t: { boundingBox: { width: number; height: number } }) => {
        const bb = t.boundingBox;
        return bb && bb.width > 0 && bb.height > 0;
      });
      const elements = targets.map((t: { tag: string; boundingBox: { x: number; y: number; width: number; height: number }; accessibleName?: { text?: string }; attributes?: { id?: string; name?: string } }) => {
        const bb = t.boundingBox;
        const cx = Math.round(bb.x + bb.width / 2);
        const cy = Math.round(bb.y + bb.height / 2);
        const label = (t.accessibleName?.text ?? "").trim() || t.attributes?.id || t.attributes?.name || t.tag;
        return `  (${cx}, ${cy})  ${t.tag} "${label}"`;
      }).join("\n");
      messages.push({
        role: 'user',
        content: `Goal: ${input.goal}\n\nURL: ${input.observation.url}\nTitle: ${input.observation.title}\n\nClickable elements:\n${elements || "  (none visible)"}`,
      });
    }

    return messages;
  }

  // ponytail: buffered SSE — assemble full response then parse. Memory ceiling is
  // a few MB of transcript per call. Switch to incremental parsing if peak memory
  // matters or when tool-call deltas need real-time exposure.
  private async readSseStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<SseChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const toolCallsMap = new Map<number, { name: string; arguments: string }>();
    let contentAcc = '';
    let done = false;
    let processedUpTo = 0; // ponytail: offset into buffer to avoid re-processing lines on each read

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') { done = true; return; }
      let parsed: SseChunk | undefined;
      try { parsed = JSON.parse(data) as SseChunk; } catch { return; }
      if (!parsed.choices || parsed.choices.length === 0) return;
      const delta = parsed.choices[0]?.delta;
      if (!delta) return;
      if (delta.content) contentAcc += delta.content;
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          const existing = toolCallsMap.get(idx) ?? { name: '', arguments: '' };
          if (tc.function.name) existing.name += tc.function.name;
          if (tc.function.arguments) existing.arguments += tc.function.arguments;
          toolCallsMap.set(idx, existing);
        }
      }
    };

    try {
      while (!done) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        // Only process NEW lines since last iteration (up to last newline)
        const lastNewline = buffer.lastIndexOf('\n');
        if (lastNewline > processedUpTo) {
          const newPart = buffer.slice(processedUpTo, lastNewline);
          for (const line of newPart.split('\n')) processLine(line);
          processedUpTo = lastNewline + 1;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const tool_calls = Array.from(toolCallsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => ({
        index: 0,
        function: {
          name: v.name,
          arguments: v.arguments,
        },
      }));

    return {
      choices: [
        {
          index: 0,
          delta: {
            content: contentAcc || undefined,
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
          },
        },
      ],
    };
  }

  private buildActionProposal(
    input: PlanningInput,
    toolCalls: NonNullable<NonNullable<SseChunk['choices']>[0]['delta']['tool_calls']>,
  ): ActionProposalV1 | { kind: 'question'; observationId: ObservationV1['observationId']; question: string; choices: undefined; proseOnly?: boolean; toolError?: boolean } {
    const faraToolCalls: FaraToolCall[] = toolCalls.map((tc) => ({
      name: tc.function.name ?? '',
      arguments: (() => {
        try {
          return JSON.parse(tc.function.arguments ?? '{}');
        } catch {
          return {};
        }
      })(),
    }));

    // ponytail: extract memoryUpdates from the FIRST tool call's arguments and
    // forward them on the proposal so the harness can merge into working memory.
    // Also legacy-compat: if the model emits `memorize_fact`, extract `fact` into
    // a memoryUpdate and rewrite the call to a no-op screenshot so the parser
    // doesn't fail on a now-removed schema.
    const firstArgs = (faraToolCalls[0]?.arguments ?? {}) as Record<string, unknown>;
    // ponytail: validate model-emitted memoryUpdates against goal keywords
    // before accepting them. Rejects facts that don't cite the goal domain
    // (e.g. SOCKENUP.IN shipping data under an "Amazon package" goal). Emits
    // a corrective if any update was rejected.
    const memValidation = validateMemoryUpdatesForGoal(firstArgs.memoryUpdates, input.goal);
    if (memValidation.rejected.length > 0) {
      const reasons = memValidation.rejected.map((r) => r.reason).join(" | ");
      return {
        kind: 'question',
        observationId: input.observation.observationId,
        question: `Some memoryUpdates were rejected because they don't match the goal domain. ${reasons} Re-issue the tool call with ONLY memoryUpdates that match the goal domain, or remove them entirely.`,
        choices: undefined,
        proseOnly: true,
        toolError: true,
      };
    }
    const memoryUpdates = memValidation.accepted;
    if (faraToolCalls[0]?.name === 'memorize_fact' || faraToolCalls[0]?.name === 'pause_and_memorize_fact') {
      const legacyFact = typeof firstArgs.fact === 'string' ? firstArgs.fact.trim() : '';
      if (legacyFact) {
        memoryUpdates.push({ key: 'fact', value: legacyFact, evidence: 'legacy memorize_fact tool call' });
      }
      faraToolCalls[0] = { name: 'screenshot', arguments: { reasoning: typeof firstArgs.reasoning === 'string' ? firstArgs.reasoning : 'Recording a finding.' } };
    }

    // ponytail: validate terminate requires non-empty finalAnswer. Without this
    // gate, the model terminates without producing an answer and the user sees
    // an empty result. Reject and re-prompt so the loop continues. This is an
    // INTERNAL harness correction — the user does not see it; the local-driver
    // silently injects the corrective guidance.
    if (faraToolCalls[0]?.name === 'terminate') {
      const fa = typeof firstArgs.finalAnswer === 'string' ? firstArgs.finalAnswer.trim() : '';
      const ans = typeof firstArgs.answer === 'string' ? firstArgs.answer.trim() : '';
      const finalAnswer = fa || ans;
      if (!finalAnswer) {
        return {
          kind: 'question',
          observationId: input.observation.observationId,
          question: 'You called terminate without a non-empty finalAnswer. Populate finalAnswer with the user\'s actual answer (a value you saw in the page text), then call terminate again.',
          choices: undefined,
          proseOnly: true,
          toolError: true,
        };
      }
    }

    const parser = new ToolCallParser();
    // ponytail: feed the parser the current observation's semantic
    // targets so click tool calls' targetId can be resolved to (x, y)
    // bbox centers. Mirrors browser-use / computer-use semantics.
    if (Array.isArray(input.observation?.semanticTargets)) {
      parser.setLastSemanticTargets(input.observation.semanticTargets);
    }
    let parseResult;
    try {
      parseResult = parser.parse(faraToolCalls);
    } catch (err) {
      // ponytail: parser throws on missing/invalid required fields. Convert
      // to an internal corrective QuestionProposal (proseOnly+toolError) so
      // the local-driver injects guidance silently — the user does not see
      // raw parser errors as questions.
      const message = (err as { error?: string })?.error ?? String(err);
      console.warn(`[planner] tool parser threw; emitting internal corrective: ${message.slice(0, 200)}`);
      return {
        kind: 'question',
        observationId: input.observation.observationId,
        question: `Your last tool call had invalid arguments: ${message}. Re-issue with valid arguments matching the schema — for example, scroll(deltaX, deltaY) only needs the deltas, no x/y.`,
        choices: undefined,
        proseOnly: true,
        toolError: true,
      };
    }

    if (parseResult.errors.length > 0) {
      // ponytail: model produced a tool call with bad/missing arguments
      // (common with smaller models). Internal corrective — silent in the UI.
      console.warn(`[planner] tool parser errors; emitting internal corrective: ${parseResult.errors[0].error.slice(0, 200)}`);
      return {
        kind: 'question',
        observationId: input.observation.observationId,
        question: `Your last tool call had invalid arguments: ${parseResult.errors[0].error}. Re-issue with valid arguments matching the schema.`,
        choices: undefined,
        proseOnly: true,
        toolError: true,
      };
    }

    if (parseResult.actions.length === 0) {
      throw new OpenAICompatiblePlannerError('No valid actions parsed from tool calls', false);
    }

    // ponytail: parser produces FaraActionArgs shape (nested coordinates/viewport),
    // wire format is ExecutableActionV1 (flat x/y). Transform so downstream sees
    // the shape it expects.
    const parsedAction = parseResult.actions[0];
    const executableAction = toExecutableAction(parsedAction.action) as Record<string, unknown>;
    if (memoryUpdates.length > 0) {
      executableAction.memoryUpdates = memoryUpdates;
    }
    const now = new Date().toISOString();
    return {
      kind: 'action',
      proposalId: crypto.randomUUID() as never,
      observationId: input.observation.observationId,
      taskId: input.taskId,
      proposedAt: now,
      rationale: 'model proposal',
      action: executableAction,
    };
  }

  private buildCompletionProposal(
    input: PlanningInput,
    content: string,
  ): CompletionProposalV1 {
    const candidate = {
      kind: 'completion',
      observationId: input.observation.observationId,
      type: 'terminate',
      status: 'partial' as const,
      summary: content || ' ',
      findings: [],
      unmetCriteria: [],
      confidence: 0.5,
    };
    const completionResult = AgentProposalV1Schema.safeParse(candidate);

    if (!completionResult.success) {
      // ponytail: log every Zod issue (not just the first) and the constructed
      // payload so the next regression is debugable in the server log without
      // re-running the demo. Then throw with the same information.
      const issueList = completionResult.error.issues
        .map((i) => `${i.path.length > 0 ? i.path.join('.') : '<root>'}: ${i.message}`)
        .join('; ');
      console.error(`[planner] buildCompletionProposal validation failed: ${issueList}`);
      console.error(`[planner] buildCompletionProposal payload:`, JSON.stringify(candidate));
      throw new OpenAICompatiblePlannerError(
        `Completion proposal schema validation failed: ${issueList}`,
        false,
      );
    }

    return completionResult.data as CompletionProposalV1;
  }
}

// ponytail: convert parser's FaraActionArgs shape (nested coordinates/viewport)
// to wire ExecutableActionV1 shape (flat x/y) that downstream consumers expect.
// Also threads `reasoning`, `finalAnswer` (for terminate), and `memoryUpdates`
// (optional on every action) so the harness can surface them in the side panel
// and merge memory.
function toExecutableAction(parsed: unknown): Record<string, unknown> {
  const a = parsed as {
    type?: string;
    coordinates?: { x?: number; y?: number; start?: { x?: number; y?: number }; end?: { x?: number; y?: number } };
    viewport?: { viewportWidth?: number; viewportHeight?: number };
    delta?: { deltaX?: number; deltaY?: number };
    text?: string;
    key?: string;
    url?: string;
    steps?: number;
    duration?: number;
    durationMs?: number;
    question?: string;
    choices?: string[];
    fact?: string;
    category?: string;
    answer?: string;
    finalAnswer?: string;
    reasoning?: string;
    memoryUpdates?: unknown;
  };
  const reasoning = typeof a.reasoning === "string" ? a.reasoning : "";
  const memoryUpdates = validateMemoryUpdates(a.memoryUpdates);
  const base = (obj: Record<string, unknown>): Record<string, unknown> =>
    memoryUpdates.length > 0 ? { ...obj, memoryUpdates } : obj;
  switch (a.type) {
    case 'left_click':
    case 'double_click':
    case 'right_click':
    case 'mouse_move':
      return base({ type: a.type, x: a.coordinates?.x ?? 0, y: a.coordinates?.y ?? 0, reasoning });
    case 'drag':
      return base({
        type: 'drag',
        startX: a.coordinates?.start?.x ?? 0,
        startY: a.coordinates?.start?.y ?? 0,
        endX: a.coordinates?.end?.x ?? 0,
        endY: a.coordinates?.end?.y ?? 0,
        reasoning,
      });
    case 'scroll':
      return base({ type: 'scroll', deltaX: a.delta?.deltaX ?? 0, deltaY: a.delta?.deltaY ?? 0, reasoning });
    case 'key':
      return base({ type: 'key', key: a.key ?? '', reasoning });
    case 'insert_text':
      return base({ type: 'insert_text', text: a.text ?? '', reasoning });
    case 'visit_url':
      return base({ type: 'visit_url', url: a.url ?? '', reasoning });
    case 'history_back':
      return base({ type: 'history_back', steps: a.steps ?? 1, reasoning });
    case 'wait':
      return base({ type: 'wait', durationMs: a.durationMs ?? a.duration ?? 1000, reasoning });
    case 'screenshot':
      return base({ type: 'screenshot', reasoning });
    case 'ask_user_question':
      return base({ type: 'ask_user_question', question: a.question ?? '', reasoning });
    case 'terminate':
      return base({ type: 'terminate', finalAnswer: a.finalAnswer ?? a.answer ?? '', reasoning });
    case 'memorize_fact':
    case 'pause_and_memorize_fact':
      // ponytail: legacy tool — planner rewrites these to screenshot before parsing.
      // This branch is defensive: if a model slips one through, normalize to
      // a no-op screenshot so the loop survives.
      return base({ type: 'screenshot', reasoning });
    default:
      return memoryUpdates.length > 0 ? { ...(a as Record<string, unknown>), memoryUpdates } : (a as Record<string, unknown>);
  }
}
