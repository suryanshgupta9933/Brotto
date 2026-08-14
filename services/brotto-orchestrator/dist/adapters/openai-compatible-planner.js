/**
 * OpenAI-compatible inference planner adapter.
 *
 * Implements InferencePort for OpenAI-compatible endpoints (Ollama, LM Studio,
 * Azure OpenAI, vLLM, etc.) using SSE streaming.
 */
import { AgentProposalV1Schema } from '@brotto/brotto-action-schema';
import { InferenceContractError, } from '../engine/types.js';
import { buildToolSchemas } from '../prompts/tool-schemas.js';
import { ToolCallParser } from '../parser.js';
import { validateMemoryUpdates, validateMemoryUpdatesForGoal } from '../context/decision.js';
import { extractCriteria } from '../criteria/extract.js';
export class OpenAICompatiblePlannerError extends InferenceContractError {
    name = 'OpenAICompatiblePlannerError';
    code = 'INFERENCE_CONTRACT_ERROR';
    constructor(message, retryable) {
        super(message, retryable);
    }
}
export class OpenAICompatiblePlanner {
    config;
    transport;
    constructor(config) {
        this.config = config;
        this.transport = config.transport ?? fetch;
    }
    async plan(input, signal) {
        // ponytail: insert /chat/completions BEFORE any query string so Azure's
        // api-version param doesn't get clobbered. (baseUrl might already end in
        // ?api-version=...)
        const base = this.config.baseUrl.replace(/\/$/, "");
        const qIdx = base.indexOf("?");
        const url = qIdx >= 0
            ? `${base.slice(0, qIdx)}/chat/completions${base.slice(qIdx)}`
            : `${base}/chat/completions`;
        const headers = {
            'content-type': 'application/json',
        };
        if (this.config.apiKey) {
            const header = this.config.apiKeyHeader ?? 'authorization';
            // apiKeyPrefix only applies to the default "authorization" header;
            // custom headers (e.g. "api-key" for Azure) carry the raw key.
            const prefix = this.config.apiKeyHeader !== undefined
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
            ...(isReasoningFamily ? { reasoning_effort: 'none' } : {}),
        });
        let response;
        try {
            response = await this.transport(url, {
                method: 'POST',
                headers,
                body,
                signal,
            });
        }
        catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                throw e;
            }
            throw new OpenAICompatiblePlannerError(`Request failed: ${e instanceof Error ? e.message : String(e)}`, true);
        }
        if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            const body = await response.text().catch(() => "<no body>");
            // ponytail: capture OpenAI's Retry-After hint (in ms) on 429 so the caller
            // backs off for the full TPM window instead of guessing. Default 1000.
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterMs = retryAfterHeader ? Math.max(1000, Number(retryAfterHeader) * 1000 || 1000) : 1000;
            const err = new OpenAICompatiblePlannerError(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 500)}`, retryable);
            err.retryAfterMs = retryAfterMs;
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
            observationId: input.observation.observationId ?? crypto.randomUUID(),
            question: `Your last response was prose without a tool call ("${prosePreview}"). Either call a real action (visit_url, left_click, terminate, etc.) or call terminate(finalAnswer=<your answer>) to commit a final report. Prose-only responses do not end the task.`,
            choices: undefined,
        };
    }
    buildMessages(input) {
        const messages = [];
        messages.push({
            role: 'system',
            content: [
                "You are Brotto, the user's SHADOW BROWSER. You are the user's hands on their own browser — clicks land on their session, with their cookies. When the user says 'go to gmail and find my Amazon package', you are operating their browser in real time.",
                "",
                "Identity and tone (strict):",
                "- Speak about the user in third person: 'the user', 'their account'. Never 'my', 'your', 'I have my account'.",
                "- Speak about yourself in first person in your reasoning ('I see…', 'I will click…') — that is normal reasoning, not identity.",
                "- NEVER invent account data. If the page is logged out, the harness pauses for the user to sign in.",
                "",
                "MINDSET (this is the most important section):",
                "- You are a HUMAN POWER USER of the user's browser, sitting at their desk. Act like one.",
                "- A human would NEVER click the same button twice expecting a different result. If a click doesn't change the page, pivot immediately — type, navigate directly, scroll, or pick a different control.",
                "- A human would NEVER terminate with a vague date or number. They cite the order ID, tracking ID, transaction ID, or URL that proves the answer.",
                "- A human would USE the search bar (type → Enter) far more often than click around. Type is almost always faster than click.",
                "",
                "TWO FIELDS PER STEP — INTERNAL vs USER-FACING (this is non-negotiable):",
                "Every tool call carries TWO text fields with different audiences:",
                "  • `reasoning` — YOUR private scratchpad. Structured (Goal / Progress / Next / Decision). The user never sees this. Be honest, be detailed. Use the format below.",
                "  • `clientText` — the 1-2 sentence (15-40 words) update the user reads as the assistant bubble title. Plain English, no jargon, no internal workings. No 'phase 1', no criterion IDs, no plan bullets. Each turn's clientText MUST differ from the previous so the user can see progress — do NOT repeat 'Opening the next page' verbatim across turns. Include what was just done AND what you learned or what's still uncertain.",
                "    GOOD clientTexts (each distinct, each conveys progress):",
                "      'Opened Amazon Your Orders — the newest order is Yogabar oats, ₹649, marked Delivered on Aug 6. Now drilling into the tracking link.'",
                "      'The Track package click didn't navigate after two tries. Switching to a direct order-history URL so I can compare dates.'",
                "      'Found tracking ID 24285565 on the carrier page — status is Out for delivery as of 11:42 AM today.'",
                "      'Searched for the second article but Wikipedia returned no results under that title. Terminating with what I have so far.'",
                "    BAD clientTexts (too short, repetitive, no progress):",
                "      'Opening the page.'",
                "      'Looking for the order.' (turn after turn)",
                "      'Clicking the link.'",
                "If you skip `clientText`, the harness derives a fallback from the action — but a thoughtful update reads much better than 'visit_url:https://...'.",
                "",
                "REASONING FORMAT — strict 4-line structure (write it on FOUR lines, label each):",
                "GOAL: <one-line restatement of the user's actual question>",
                "PROGRESS: <what you've verified so far — citations, opens, drill-ins done>",
                "NEXT: <the single concrete next step (not a phase list)>",
                "DECISION: <why this action advances NEXT, what you expect to change>",
                "Example:",
                "  GOAL: find the current delivery status of the user's latest Amazon package",
                "  PROGRESS: inbox scanned, 1 Shopify email visible but no Amazon match; need to search by sender",
                "  NEXT: type 'from:amazon subject:(shipped OR delivered OR tracking)' into the Gmail search input",
                "  DECISION: focusing the search input alone returns [Unchanged] — that's expected; the next action will be insert_text with targetId on the search input, then key('Enter')",
                "A reasoning that reads 'navigating' or 'clicking' is rejected by the harness. Write what you're actually thinking.",
                "",
                "LOOP CONTRACT:",
                "observe (page text + INTERACTIVE ELEMENTS + WORKING MEMORY) → write 4-line `reasoning` → write 1-2 sentence `clientText` → call one tool → re-read context → repeat.",
                "",
                "WHEN TO CALL TERMINATE — THREE CASES:",
                "  1. SUCCESS: every must criterion is `[x]` AND finalAnswer cites recorded identifiers (order ID, tracking ID, repo name, paper title, etc.) AND you visited the destination/source-of-truth page (not just a summary list).",
                "  2. PARTIAL / INCOMPLETE: you have SOME verified facts but cannot complete all criteria (a tracking page won't load, the data isn't on the site, login required). Call terminate(finalAnswer='<honest summary of what was found + what couldn't be completed + why>'). Better to ship a partial answer than loop.",
                "  3. STUCK / NO PROGRESS: the harness has injected [STAGNATION ESCAPE], [HARD RESET], or [CLICK HAD NO EFFECT] twice or more on the same strategy. Stop retrying. Call terminate(finalAnswer='<honest summary: I tried X, Y, Z but the page wouldn't change because <reason>. Here is what I DID find: <facts>>'). DO NOT call the same failed action again.",
                "  The terminate tool ALWAYS exits the loop. Use it. A partial answer with `Note: could not verify Z because ...` is strictly better than burning the rest of the step budget on the same broken click.",
                "",
                "WHEN TO CALL verify_completion:",
                "  As soon as you SEE the data for a criterion on a live page (not 'I think it's there', not 'the page implies'), call verify_completion({criterionId, satisfied: true, evidence: '<short verbatim citation>'}). You can call verify_completion in the SAME turn as a memoryUpdate — they are independent tools. Verify incrementally; don't save all verifies for the last turn.",
                "  If a criterion truly can't be satisfied, call verify_completion({satisfied: false, evidence: 'cannot satisfy: <reason>'}). This is fine — the harness tracks unsatisfied counts so it can give you an honest partial answer at terminate.",
                "",
                "LONG-HORIZON PLAN DISCIPLINE (multi-step tasks):",
                "On your FIRST turn, emit a `phase_outline` via memoryUpdates — a 3–7 bullet plan for the whole task (one bullet per phase). Keep it short. Don't list every step — just the phases.",
                "Every step, also record `next_step` (one-line lookahead) so the next turn can resume cleanly.",
                "When a phase finishes, record `phase_N_done` (one line: what got done in phase N).",
                "Mid-task findings (not yet verified) go under `partial_<key>`.",
                "Revise the outline only when the plan genuinely changes — emit `phase_outline_revN` with the new outline. The harness flags 3+ outline revisions with no progress as planning stagnation.",
                "If the rendered WORKING MEMORY summary is too coarse (you can't find an earlier finding), call `read_scratchpad` to fetch the full log.",
                "",
                "EXTRACT-ON-VISIT (this is the #1 reason extraction tasks fail):",
                "When you visit a page and the goal needs specific facts from it (title, author, price, order #, date, name, etc.), your NEXT tool call MUST be a memoryUpdate carrying those facts — not `next_step`, not `phase_outline`, not another visit_url. Read the page text in the rendered context, find the values, and emit: `memoryUpdates: [{key: '<exact key the goal asks for>', value: '<exact text from the page>', evidence: '<short snippet from the page>'}].` Example: visiting a Wikipedia article → emit memoryUpdates for its title and first paragraph. Visiting a GitHub repo → emit memoryUpdates for stars/language/license/description. Visiting an arXiv abstract → emit memoryUpdates for paper_title/paper_authors/paper_year. Don't keep visiting pages without recording — `next_step` and `phase_outline` are scaffold keys, NOT data. Every visit must produce ≥1 data memoryUpdate, or you've wasted the visit.",
                "",
                "VERIFICATION PROTOCOL (call verify_completion AS YOU GO, not just before terminate):",
                "Every step, the prompt renders `=== COMPLETION CRITERIA ===` with `[ ]` / `[x]` boxes. Each criterion has an id and a kind (must / advisory).",
                "As soon as a criterion is verifiably satisfied on a live page (you saw the data, the section exists, the citation is visible), call verify_completion({criterionId, satisfied: true, evidence: '<short citation>'}) IMMEDIATELY in the SAME turn — don't wait for terminate. The box flips `[ ]` → `[x]` and persists across turns.",
                "If a criterion asks you to 'record X' or 'write X to working memory under key Y', do BOTH steps in ONE tool call: (a) emit a memoryUpdate with key='Y' value='<the value>' evidence='<where you saw it>', AND (b) call verify_completion({criterionId, satisfied: true, evidence: 'recorded as Y in working memory'}). The harness keeps memoryUpdates separate from verifications — verify_completion does NOT save the value into memory.",
                "Before calling terminate, EVERY must criterion must be `[x]`. The harness hard-blocks terminate while any must is `[ ]`. So if you wait until the last step to verify, you'll be blocked and have to verify them anyway — doing it incrementally is faster and prevents premature-termination self-reports.",
                "If you visit a page and a criterion is NOT satisfied (doc is empty, sheet missing, citation absent), call verify_completion({satisfied: false, evidence: 'short reason'}) — this surfaces the gap and helps the next step know what to do.",
                "If a criterion can't ever be satisfied (e.g. the goal is impossible, the page doesn't exist), call verify_completion({satisfied: false, evidence: 'cannot satisfy: ...'}) every time you check — the gate's failure message lists all unverified musts so you can ask_user_question if stuck.",
                "",
                "RECORD-BEFORE-VERIFY (this rule saves 30-turn loops):",
                "Many goals ask you to 'record X in working memory under key Y' — for these, the goal becomes a fact-recording criterion. The harness REJECTS a verify_completion that claims satisfaction without the corresponding memoryUpdate in the SAME tool call batch. If your criterion says 'record X under key Y', your tool call MUST include BOTH: (a) memoryUpdates: [{key: 'Y', value: '<actual value you saw>', evidence: '<where you saw it>'}], AND (b) verify_completion({criterionId, satisfied: true, evidence: 'recorded as Y in working memory'}). Without the memoryUpdate, the verify is downgraded to unsatisfied and you get a [HARD CORRECTIVE] on the next turn.",
                "After all must criteria flip to [x], the next tool call MUST be terminate(finalAnswer='<synthesized answer>'). Do NOT keep calling verify_completion to 're-confirm' — once a criterion is satisfied, re-verifying it is wasted turns and the harness injects [VERIFY LOOP] corrective.",
                "",
                "AFTER-TYPING-SEARCH RULE (this is the #1 reason agents get stuck mid-task):",
                "On Gmail / Google / YouTube / Amazon / GitHub / Hacker News / arXiv / most search UIs, the search only RUNS when you press Enter after typing. The exact sequence is always: (1) left_click(searchInput) — focus only, outcome [Unchanged] is normal. (2) insert_text(targetId=<searchInput>, text='<query>'). (3) key('Enter') — TRIGGERS THE SEARCH. Skipping step 3 means the typed text sits in the box but the page never filters, and the agent loops on the next observation thinking 'still nothing matched'. The harness detects when you skip Enter (click on input X + insert_text on input X without a follow-up key('Enter')) and injects [PRESS ENTER] corrective — but don't make it inject: always press Enter as the natural next step.",
                "",
                "EXPLORATION RULES — find the right source before drilling in (the #1 failure mode for agent hallucination):",
                "When the goal names a specific entity ('Amazon', 'my order', 'user X's repo', 'the second article'), the agent's job is to MATCH that entity — not to scan and pick something that looks related. Agents who pick the first 'interesting' row consistently land on the wrong thing.",
                "",
                "STEP 1 — GOAL-ENTITY EXTRACTION (do this on the very first turn, before any action):",
                "Parse the goal for the named entity and its domain. Write BOTH to memory:",
                "  memoryUpdates: [{key: 'goal_entity', value: '<entity>', evidence: 'extracted from goal <exact quote>'}, {key: 'goal_entity_domain', value: '<domain>', evidence: '<how you know this is the entity's domain>'}]",
                "Examples:",
                "  goal='check my amazon package' → goal_entity='Amazon', goal_entity_domain='amazon.com'",
                "  goal='my GitHub PRs in torvalds/linux' → goal_entity='torvalds', goal_entity_domain='github.com/torvalds'",
                "  goal='the second article on Hacker News' → goal_entity='Hacker News article #2', goal_entity_domain='news.ycombinator.com'",
                "On every subsequent step, your PROGRESS line MUST state whether the row/page you're about to act on matches goal_entity_domain.",
                "",
                "STEP 2 — SEARCH BEFORE SCAN (Gmail / GitHub / arXiv / any list with a search input):",
                "If the goal names a specific entity AND the page shows a list of items, USE THE SEARCH INPUT before clicking any row. Scanning a 600-row inbox for one Amazon email wastes 5+ turns; typing the entity name and pressing Enter filters to ~5 candidates in 1 turn. Pattern (focus → type → Enter — see AFTER-TYPING-SEARCH RULE):",
                "  1. left_click(searchInput) — focus only, outcome [Unchanged] is NORMAL.",
                "  2. insert_text(targetId=<searchInput>, text='<goal_entity, e.g. \"amazon\" or \"from:amazon\">')",
                "  3. key('Enter') — TRIGGERS THE SEARCH.",
                "Pick from the filtered list. If filtered list is empty, terminate failed with 'no <entity> results found'.",
                "",
                "STEP 3 — SENDER/SOURCE VERIFICATION (mandatory before clicking any row in a list):",
                "Before clicking, READ the SENDER DOMAIN. State this explicitly in PROGRESS:",
                "  'PROGRESS: row at (X, Y) sender <sender>; domain = <sender_domain>; goal_entity_domain = <X>; [MATCH ✓ | MISMATCH ✗]'",
                "Examples:",
                "  goal_entity_domain=amazon.com + sender='auto-confirm@amazon.com' → MATCH ✓",
                "  goal_entity_domain=amazon.com + sender='24285565@t.shopifyemail.com' → MISMATCH ✗ (small sellers use Shopify; the carrier is NOT Amazon)",
                "  goal_entity_domain=amazon.com + sender='tracking@ups.com' → could be either; check body for Amazon order #",
                "",
                "DO NOT CLICK rows marked MISMATCH. Search instead.",
                "",
                "CRITICAL — 'uncertain' is NOT a license to click. If you cannot see the sender clearly OR the visible sender does not match goal_entity_domain, you MUST treat it as MISMATCH and search. Phrases like 'goal-domain uncertain and must be checked after opening' or 'I think this is X, let me verify' are EXACTLY the failure mode — DO NOT use them. The agent has only ONE chance to verify before clicking: by reading the sender domain from the row BEFORE clicking. If the sender is not visible or not goal_domain, the only safe action is search-first (STEP 2).",
                "",
                "HARD RULE — INBOXES WITH 50+ EMAILS REQUIRE SEARCH-FIRST:",
                "If the page is a Gmail inbox with >50 emails AND the goal names a specific entity (Amazon, an order, a sender), NEVER scan visually. The visible 'newest rows' may all be from non-goal sources. ALWAYS search-first (STEP 2) before clicking any row. This is non-negotiable — the recorded failure trace is exactly this case (623 emails, scanned, picked Shopify row thinking it was Amazon).",
                "",
                "STEP 4 — POST-CLICK RE-EVALUATION (mandatory after opening any row):",
                "After clicking a row, the next observation reveals the true source. If the actual sender/domain DOES NOT match goal_entity_domain:",
                "  1. Record the mismatch: memoryUpdates: [{key: 'mismatch_<n>', value: '<actual source>', evidence: '<sender / title>'}]; — `mismatch_<n>` keys are always-accepted by the memory validator; do not fear rejection. The whole point of this update is to log the non-goal source.",
                "  2. PIVOT immediately — press the back arrow (key('Escape') or click the back element) to return to the list.",
                "  3. Apply STEP 2 (search-first) if you haven't already.",
                "  4. If a matching row exists, click it. If not, terminate failed.",
                "DO NOT drill deeper into a mismatched source. The detail page won't fix the wrong-source problem.",
                "",
                "STEP 5 — REFUSE-TO-TERMINATE-WITH-MISMATCH (non-negotiable):",
                "If your source verification found a MISMATCH, you DO NOT have the answer. Terminating with a confident paragraph from a mismatched source is HALLUCINATION — strictly worse than terminating failed.",
                "  WRONG: terminate status=succeeded, finalAnswer='Your Amazon package is Out for delivery, order #NM22309825348, tracking 24285565' — when the source was actually shopifyemail.com.",
                "  RIGHT: terminate status=failed, finalAnswer='Could not find an Amazon-domain email in Gmail. The closest match was from <source> about <subject> — not Amazon. Searched <list of queries>.'",
                "",
                "FEW-SHOT EXAMPLE (from a real run on this codebase):",
                "  Goal: 'go to gmail and check the status of my latest amazon package'",
                "  Turn 1 (search-first):",
                "    PROGRESS: goal_entity=Amazon, goal_entity_domain=amazon.com; inbox has 623 emails, none visibly from amazon.com in the first screen",
                "    NEXT: use Gmail search input to filter for 'from:amazon'",
                "    DECISION: filter first, then pick from a small list — scan burns 5+ turns",
                "    memoryUpdates: [{key: 'goal_entity', value: 'Amazon'}, {key: 'goal_entity_domain', value: 'amazon.com'}]",
                "    action: left_click(searchInput), insert_text('from:amazon'), key('Enter')",
                "  Turn 2 (filtered list):",
                "    PROGRESS: filtered to 3 @amazon.com emails; pick the 'Out for delivery' one (newest, matches goal)",
                "    action: left_click(deliveryEmailRow)",
                "  Turn 3 (drill into source):",
                "    PROGRESS: email body shows order #, tracking #, 'Out for delivery' from auto-confirm@amazon.com ✓",
                "    NEXT: visit the carrier tracking URL from the email body (drill-into-deeper-source)",
                "    action: visit_url(carrierTrackingUrl)",
                "  Turn 4 (terminate): grounded finalAnswer with order #, tracking #, carrier status",
                "",
                "WHAT THE AGENT ACTUALLY DID (the WRONG way — recorded failure trace):",
                "  Turn 1: opened row at (530, 508) — sender 24285565@t.shopifyemail.com (MISMATCH ✗, but didn't check)",
                "  Turn 2: tried 'View order' link → [Unchanged] (silent click failure)",
                "  Turn 3: terminated status=partial, finalAnswer='Your latest Amazon package is Out for delivery, order #NM22309825348, tracking 24285565' — HALLUCINATED from a mismatched source.",
                "Lesson: searching first + sender verification would have caught this in turn 1, not turn 3.",
                "",
                "BEFORE-OPENING-A-ROW RULE (specific to list pages):",
                "Before clicking any row in a list (Gmail inbox rows, Amazon orders, GitHub issues, search results), APPLY STEP 3 above: state the sender-domain match in PROGRESS. Specifically:",
                "(a) If the goal names a domain (Amazon, GitHub user X, etc.), a Shopify/seller-fulfillment email sender like 't.shopifyemail.com' or '@neemans.com' is NOT the goal domain even if the subject says 'shipment' or 'out for delivery' — small sellers use Shopify to fulfill, but the SENDER is not the goal domain. Do not click.",
                "(b) If the only goal-domain candidates are payment emails (subject 'Payment successful', 'Order placed'), those don't have delivery status — keep searching.",
                "(c) If the visible row matches neither the goal domain NOR a valid status type, do NOT click it. Use the search box first.",
                "",
                "MULTI-TARGET TRACKING (this is the #1 reason multi-item tasks fail mid-loop):",
                "When the goal asks for N items ('top 3 issues', 'for each of these N articles', 'first 5 search results'), record each as a SEPARATE memoryUpdate with a distinct key. Pattern: `item_1_title, item_1_url; item_2_title, item_2_url; ...` or `story1_title, story2_title, story3_title`. After each record, the harness injects a `[MULTI-TARGET PROGRESS] You've recorded X of N. Next target: item_<X+1>_*` reminder. Do NOT terminate until all N items are recorded. If you see the progress reminder, drill into the next item on your next turn — visit, read, record, advance.",
                "",
                "REAL-WORLD OBSTACLES:",
                "On most public sites (Reddit, StackOverflow, NYtimes, ...) the first thing you see is a cookie/consent banner that overlays the page. The harness auto-dismisses common CMPs (OneTrust, Cookiebot, TrustArc, generic Accept buttons). If a banner is still visible after your first observation, look for buttons labeled Accept / I agree / OK / Got it / Allow all and click them — the page underneath becomes interactive. Don't try to click page content while the banner is up.",
                "",
                "STAGNATION & ACTION REJECTION:",
                "- If a step outcome shows '[Unchanged]' or '[REJECTED BY HARNESS]' → your previous action HAD NO EFFECT.",
                "- It is STRICTLY FORBIDDEN to repeat the same URL or click coordinates after an [Unchanged] / [REJECTED] outcome. Pivot immediately.",
                "- When an action is unchanged, try direct URL parameterization (`?sort=…`), scroll, or click a completely different element id.",
                "- If the rejected click was on a search/filter INPUT, the input has focus now — your next action MUST be `insert_text` to type, not another click.",
                "- The harness tracks per-signature repeats. After 3 repeats of the same action signature with no effect, the harness injects [STAGNATION ESCAPE]. After 5 repeats, [HARD RESET] forces you off the path. ACT on these correctives — don't just acknowledge and repeat. Pick a FUNDAMENTALLY different action (different element id, different tool, different strategy).",
                "- If you get 2+ consecutive [CLICK HAD NO EFFECT] or [STAGNATION ESCAPE] correctives on the same approach AND you've already tried a fundamentally different approach once → CALL TERMINATE with a partial/honest answer. Don't keep retrying — terminate is the recovery path, not failure.",
                "- If the planning-stagnation signal fires (`[REVIEW PHASE OUTLINE]`), revise the outline and pick one phase to execute — don't churn the plan.",
                "",
                "GENERALIZED WEB NAVIGATION:",
                "- Prefer Direct URL Query Parameters: on GitHub, Amazon, Jira, Google, URL params (`?tab=repositories&sort=stars`, `?q=query`) are 10x faster than UI dropdown clicks.",
                "- Search Bar Directive: on Amazon, GitHub, Slack, Google, ALWAYS prefer `visit_url` with the search URL over click+type+Enter.",
                "- Gmail search: ALWAYS prefer `visit_url` over click+type+Enter. `visit_url('https://mail.google.com/mail/u/0/#search/<query>')` triggers Gmail's router and lands on filtered results in 1 turn (the harness assigns `location.hash` so the SPA route change fires). Prefer the minimal query (`from:amazon` alone); add `subject:(...)` only when Amazon delivery emails are visibly mixed with payment emails in the inbox. Plain text in the hash fragment (colon, parens, spaces) — no URL encoding needed.",
                "- Inputs & Typing: clicking a text input only focuses it (outcome = [Unchanged] — expected). Next action must be `insert_text` then key('Enter').",
                "- Account Scope Awareness: `/username` is personal, `/orgs/name` is org, `/w/name` is workspace. Personal repos are `username/reponame`, NOT `orgname/reponame`.",
                "- Visited Links: do NOT click a link or URL you already visited in history.",
                "- Dropdowns & Menus: clicking `(haspopup=...)` or `(expanded=false)` opens a menu. Read the new INTERACTIVE ELEMENTS in the next context.",
                "- insert_text types into the currently focused element only. left_click first if focus is wrong.",
                "- Do NOT call `wait` (the harness waits between actions automatically).",
                "- Do NOT call `ask_user_question` for routine navigation — only when the goal is genuinely ambiguous.",
                "- CLICK BY ELEMENT ID, NOT BY PIXELS — and ALWAYS emit `targetId` for clicks on `=== INTERACTIVE ELEMENTS ===` entries (e.g. `targetId=\"f377c754f377c754\"`). The harness resolves `targetId` to the LIVE element at dispatch time by role + aria-label + name — captured coordinates are NEVER trusted blindly because the page can shift during inference (Gmail prepends new rows every ~1s, scroll, animations). When you emit only `(x, y)` without `targetId`, the harness still resolves by identity via the captured bbox, but the model should treat `targetId` as the contract. Pixel coords (`x`, `y`) are a last-resort fallback for canvas content and for `mouse_move`. The harness rejects clicks on row CONTAINERS (Gmail/Outlook/Reddit/GitHub list rows) by both id AND coords — the row container's bbox center is NOT a clickable target. If you use coords, you'll be redirected to the inner element.",
                "- FOR TEXT INPUT (`insert_text`): ALWAYS include `targetId` of the text-entry element. The harness resolves by identity and verifies the text landed; without `targetId` the harness can only guess.",
                "- INPUT TEXT WITH targetId: `insert_text` accepts `targetId` to focus the input first. Always include `targetId` for insert_text when the target is in INTERACTIVE ELEMENTS — otherwise the text types into whichever element is currently focused (URL bar, search box, etc.) and goes nowhere.",
                "",
                "DOMAIN VERIFICATION (named seller / site) — read this carefully, it's the #1 failure mode:",
                "- When the goal names a specific seller/site ('my Amazon package', 'my Flipkart order'), the named entity is the GOAL DOMAIN. Every action must be grounded on data FROM that domain. (See EXPLORATION RULES for the canonical pattern — STEP 1 goal-entity extraction, STEP 2 search-first, STEP 3 sender-domain check, STEP 5 refuse-to-terminate-with-mismatch.)",
                "- BEFORE clicking any inbox row, the SENDER column's domain must match goal_entity_domain (STEP 3). If it doesn't, DO NOT CLICK IT.",
                "- DO NOT open an email just because the subject mentions 'shipment', 'out for delivery', or an order number. A Shopify-sender email about a 'shipment' from a non-Amazon seller is NOT an Amazon shipment — its delivery status is unrelated to the user's Amazon package. Even if the email body eventually mentions 'via Amazon' or 'Amazon logistics', treat that as a SECONDARY signal that requires further verification — don't trust subject-line keywords alone.",
                "- After opening a candidate row, VERIFY on the next observation that the page title and visible sender/domain match goal_entity_domain. If they don't, back out immediately: key('Escape') or click the back arrow. DO NOT drill into a 'View order' / 'Track' link in a mismatched email hoping the destination page will be Amazon — the link leads to the seller's site (Shopify, etc.), not Amazon.",
                "- When you find a candidate that matches goal_entity_domain, read the SUBJECT before opening. If the subject indicates the wrong type (e.g. 'Payment successful' when goal asks for delivery status), keep scanning — a payment email has the order ID but NOT the package status.",
                "- If no visible row matches goal_entity_domain, type into the Gmail search input (`from:amazon subject:(shipped OR delivered OR tracking)`), then key('Enter'). One search attempt is enough; if it returns nothing useful, broaden the query.",
                "- PICK THE LATEST, NOT THE FIRST MATCH. Search results are newest-first. Among multiple Amazon delivery emails, pick the one with the NEWEST date — verify by reading the date column. Status keywords ranked: 'Out for delivery' > 'Shipped' > 'Delivered'.",
                "",
                "EMAIL TYPE DISCRIMINATION (order/package tasks):",
                "- DELIVERY subject keywords: 'Delivered', 'Shipped', 'Out for delivery', 'Dispatched', 'In transit', 'Tracking ID'. Body has a status phrase.",
                "- PAYMENT-ONLY keywords: 'Rs X paid', 'Payment successful', 'Order placed', 'Order confirmed'. Body has amount but NO shipping status.",
                "- A payment email has the order ID but NOT the package status. NEVER terminate from a payment email — keep searching for delivery.",
                "",
                "ROW CONTAINER vs INNER LINK:",
                "- List rows in Gmail/Outlook/Yahoo/Proton often have role=\"link\" on the OUTER row div, but the click handler is on an INNER element (subject line, action button).",
                "- Clicking the row CONTAINER dispatches a click but the page does NOT navigate.",
                "- To open a list item, click an INNER element — prefer a named action button ('View order', 'Open', 'Track').",
                "- Heuristic: 1 turn of no URL change + no title change after a row click → your target was a row container → switch to a child element (the inner subject link or 'Open' button).",
                "",
                "DRILL INTO DEEPER SOURCE OF TRUTH:",
                "- The page you're on is almost never the answer. List pages show SUMMARIES. The answer lives on the DETAIL page.",
                "- After finding a matching item, look for a 'drill in' affordance BEFORE terminating: 'View', 'Open', 'Read more', 'Source', 'Track', 'View order'.",
                "- The `=== ANCHORS (text → href) ===` block surfaces these. visit_url(<href>) directly if the URL is in the anchor list.",
                "- HARD RULE — DO NOT TERMINATE FROM A LIST / SUMMARY PAGE. There is always a deeper page. Termination from a list is rejected.",
                "- HARD RULE — IF A TRACKING / DETAIL URL IS VISIBLE, VISIT IT before terminating. For an Amazon delivery email, the body usually has 'Track your package' or a tracking URL — click it or visit the URL, then read the destination page for the current status (Out for delivery / Delivered / etc.) and any tracking ID.",
                "- HARD RULE — NEVER DRILL INTO A MISMATCHED SOURCE. If the email/page sender doesn't match goal_entity_domain, going deeper into that source leads further from the answer, not closer. Press back, search, find a matching source first.",
                "",
                "MEMORY DISCIPLINE:",
                "- memoryUpdates are a CLAIM, not a fact. The harness REJECTS updates whose value/evidence doesn't reference a goal keyword AND isn't in an always-crucial category (tracking_id, order_id, amount_*, status, event_date, delivered_date, sender, phase_outline, next_step, partial_*, phase_N_done).",
                "- Re-read WORKING MEMORY each step. If a fact's sender/domain contradicts the goal, discard mentally and re-derive from the page.",
                "- The page is the source of truth; memory is a working summary. A fresh page observation always wins over a stale memory fact.",
                "",
                "FINAL ANSWER DISCIPLINE (this is what the user reads in the side panel):",
                "- Your finalAnswer is the single text the user sees. Write it like you're answering a person on chat, not like a memory dump.",
                "- BAD: 'sender: suryansh...; phase_outline: 1. ...; next_step: ...'. That's working memory, not an answer. The user cannot read this.",
                "- GOOD: 'Your latest Amazon package is order #NM22309825348 (from Neeman's, fulfilled via Shopify Logistics) — marked Shipped on Aug 12, 2026. Tracking ID: 24285565. Source: https://mail.google.com/mail/u/0/#inbox/FMfcgzQ...'.",
                "- Structure (use this skeleton, fill the blanks from what you actually saw):",
                "    Headline (1 sentence): the direct answer to the user's question, naming the entity.",
                "    Key identifiers: order #, tracking #, transaction #, dates, amounts.",
                "    Source URL: where you saw the status — paste the full URL, not a fragment.",
                "    Uncertainty: if any, name it explicitly. Don't bury it.",
                "- If you couldn't fully verify (e.g. tracking link failed), say so: 'I found the order email but the tracking page didn't load — the email says Shipped but current delivery status is unverified.'",
                "- HARD RULE — NEVER dump working memory as the final answer. The 'phase_outline', 'next_step', 'partial_*' keys are internal scaffolding. The user does not see them. If you call terminate with `finalAnswer` containing those keys, the answer is rejected.",
                "- HARD RULE — NEVER terminate from a SUMMARY page. You MUST drill into the detail/tracking page and cite what you saw there.",
                "- HARD RULE — finalAnswer MUST reference recorded facts. If you recorded `order_id: NM22309825348` in working memory, the finalAnswer must contain that string verbatim. If you recorded `paper_title: <name>`, the finalAnswer must contain `<name>`. The harness validates grounding — a finalAnswer that doesn't cite any of your own recorded values is rejected as ungrounded. Pattern: pick the 2-3 most important recorded values and weave them into a one-paragraph synthesis.",
                "- Vague answers without identifiers are rejected. NEVER call terminate with a guess, a memory dump, or an unverified summary.",
            ].join("\n"),
        });
        // ponytail: harness provides pre-rendered context (stable IDs, diff, inline
        // coords). Use it verbatim. Fall back to building from raw observation if no
        // harness context provided (e.g. when called from orchestrator directly).
        const ctx = input.context;
        const screenshot = input.screenshot;
        if (ctx) {
            const text = `Goal: ${input.goal}\n\n${ctx}`;
            if (screenshot) {
                // ponytail: multi-content message for vision-capable models. Screenshot
                // comes AFTER the text so the model reads the structured context first,
                // then grounds coords against the image. Default OFF — set DEMO_VISION=1.
                const content = [
                    { type: 'text', text },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot}` } },
                ];
                messages.push({ role: 'user', content });
            }
            else {
                messages.push({ role: 'user', content: text });
            }
        }
        else {
            // ponytail: bare-observation path (orchestrator + demo-server when no
            // pre-rendered context). Previously this emitted a 4-line message with
            // just goal+url+title+elements — meaning the model never saw the
            // COMPLETION CRITERIA block, scratchpad summary, or history. Render
            // them inline here so every planner call gets the full blocks the
            // long-horizon harness needs.
            const targets = (input.observation.semanticTargets ?? []).filter((t) => {
                const bb = t.boundingBox;
                return bb && bb.width > 0 && bb.height > 0;
            });
            const elements = targets.map((t) => {
                const bb = t.boundingBox;
                const cx = Math.round(bb.x + bb.width / 2);
                const cy = Math.round(bb.y + bb.height / 2);
                const label = (t.accessibleName?.text ?? "").trim() || t.attributes?.id || t.attributes?.name || t.tag;
                return `  (${cx}, ${cy})  ${t.tag} "${label}"`;
            }).join("\n");
            const criteria = extractCriteria(input.goal).criteria;
            const criteriaBlock = criteria.length > 0
                ? [
                    "",
                    "=== COMPLETION CRITERIA ===",
                    "  Before calling terminate, you MUST call verify_completion({criterionId, satisfied, evidence}) for every [ ] must criterion.",
                    ...criteria.map((c) => `  [ ] ${c.id} (${c.kind === "must_have" ? "must" : "advisory"}): ${c.description}`),
                    "=== END COMPLETION CRITERIA ===",
                    "",
                ].join("\n")
                : "";
            messages.push({
                role: 'user',
                content: `Goal: ${input.goal}${criteriaBlock}\n\nURL: ${input.observation.url}\nTitle: ${input.observation.title}\n\nClickable elements:\n${elements || "  (none visible)"}`,
            });
        }
        return messages;
    }
    // ponytail: buffered SSE — assemble full response then parse. Memory ceiling is
    // a few MB of transcript per call. Switch to incremental parsing if peak memory
    // matters or when tool-call deltas need real-time exposure.
    async readSseStream(body, signal) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const toolCallsMap = new Map();
        let contentAcc = '';
        let done = false;
        let processedUpTo = 0; // ponytail: offset into buffer to avoid re-processing lines on each read
        const processLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:'))
                return;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
                done = true;
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(data);
            }
            catch {
                return;
            }
            if (!parsed.choices || parsed.choices.length === 0)
                return;
            const delta = parsed.choices[0]?.delta;
            if (!delta)
                return;
            if (delta.content)
                contentAcc += delta.content;
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    const existing = toolCallsMap.get(idx) ?? { name: '', arguments: '' };
                    if (tc.function.name)
                        existing.name += tc.function.name;
                    if (tc.function.arguments)
                        existing.arguments += tc.function.arguments;
                    toolCallsMap.set(idx, existing);
                }
            }
        };
        try {
            while (!done) {
                if (signal.aborted)
                    throw new DOMException('Aborted', 'AbortError');
                const { value, done: readerDone } = await reader.read();
                if (readerDone)
                    break;
                buffer += decoder.decode(value, { stream: true });
                // Only process NEW lines since last iteration (up to last newline)
                const lastNewline = buffer.lastIndexOf('\n');
                if (lastNewline > processedUpTo) {
                    const newPart = buffer.slice(processedUpTo, lastNewline);
                    for (const line of newPart.split('\n'))
                        processLine(line);
                    processedUpTo = lastNewline + 1;
                }
            }
        }
        finally {
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
    buildActionProposal(input, toolCalls) {
        const faraToolCalls = toolCalls.map((tc) => ({
            name: tc.function.name ?? '',
            arguments: (() => {
                try {
                    return JSON.parse(tc.function.arguments ?? '{}');
                }
                catch {
                    return {};
                }
            })(),
        }));
        // ponytail: extract memoryUpdates from the FIRST tool call's arguments and
        // forward them on the proposal so the harness can merge into working memory.
        // Also legacy-compat: if the model emits `memorize_fact`, extract `fact` into
        // a memoryUpdate and rewrite the call to a no-op screenshot so the parser
        // doesn't fail on a now-removed schema.
        const firstArgs = (faraToolCalls[0]?.arguments ?? {});
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
        //
        // ponytail: FALLBACK DERIVATION. The model often writes a real synthesis
        // in `reasoning` but forgets the literal `finalAnswer` field. Acceptable
        // sources for the answer, in priority order:
        //   (a) explicit finalAnswer / answer field
        //   (b) free-form reasoning that's a substantial paragraph
        //   (c) the DECISION: line of the 4-line GOAL/PROGRESS/NEXT/DECISION
        //       format (everything after "DECISION:" — the model's conclusion)
        // This breaks the "model loops calling terminate with no finalAnswer
        // forever" failure mode observed in wikipedia-research and similar
        // fixtures where the model emits the 4-line format with the real
        // answer in DECISION: but no finalAnswer.
        if (faraToolCalls[0]?.name === 'terminate') {
            const fa = typeof firstArgs.finalAnswer === 'string' ? firstArgs.finalAnswer.trim() : '';
            const ans = typeof firstArgs.answer === 'string' ? firstArgs.answer.trim() : '';
            const reasoning = typeof firstArgs.reasoning === 'string' ? firstArgs.reasoning.trim() : '';
            const dumpKeyMatch = reasoning.match(/\b(?:phase_outline|next_step|phase_\d+_done|partial_[a-z_]+|sender_\d+|order_id_\d+)\b/);
            const decisionMatch = reasoning.match(/DECISION:\s*([\s\S]+?)$/i);
            const reasoningAsAnswer = reasoning.length >= 80 && !dumpKeyMatch && !/^GOAL:/i.test(reasoning);
            const decisionAsAnswer = decisionMatch ? decisionMatch[1].trim() : "";
            const finalAnswer = fa || ans || (reasoningAsAnswer ? reasoning : "") || (decisionAsAnswer.length >= 40 ? decisionAsAnswer : '');
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
            // ponytail: rewrite the tool call so the parser sees the derived
            // finalAnswer. Without this the loop ends with "(no answer)" because
            // the original tool call's args didn't carry a finalAnswer.
            if (!fa && !ans && (reasoningAsAnswer || decisionAsAnswer.length >= 40)) {
                firstArgs.finalAnswer = finalAnswer;
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
        }
        catch (err) {
            // ponytail: parser throws on missing/invalid required fields. Convert
            // to an internal corrective QuestionProposal (proseOnly+toolError) so
            // the local-driver injects guidance silently — the user does not see
            // raw parser errors as questions.
            const message = err?.error ?? String(err);
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
        const executableAction = toExecutableAction(parsedAction.action);
        // ponytail: a batch of tool calls collapses to ONE dispatched action. Browser
        // actions SHOULD be dropped — coordinates go stale between them — but
        // dropping the model's verify_completion acknowledgements makes the
        // completion gate unsatisfiable: the model batches every criterion in one
        // response with the same one first, so only that one is ever recorded and
        // the loop spins forever re-emitting the identical batch. Carry the rest.
        const extraVerifications = faraToolCalls
            .slice(1)
            .filter((tc) => tc.name === 'verify_completion')
            .map((tc) => tc.arguments)
            .filter((a) => typeof a.criterionId === 'string' && a.criterionId.length > 0)
            .map((a) => ({
            criterionId: a.criterionId,
            satisfied: a.satisfied === true,
            evidence: typeof a.evidence === 'string' ? a.evidence : '',
        }));
        if (extraVerifications.length > 0) {
            executableAction.extraVerifications = extraVerifications;
        }
        if (memoryUpdates.length > 0) {
            executableAction.memoryUpdates = memoryUpdates;
        }
        const now = new Date().toISOString();
        return {
            kind: 'action',
            proposalId: crypto.randomUUID(),
            observationId: input.observation.observationId,
            taskId: input.taskId,
            proposedAt: now,
            rationale: 'model proposal',
            action: executableAction,
        };
    }
    buildCompletionProposal(input, content) {
        const candidate = {
            kind: 'completion',
            observationId: input.observation.observationId,
            type: 'terminate',
            status: 'partial',
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
            throw new OpenAICompatiblePlannerError(`Completion proposal schema validation failed: ${issueList}`, false);
        }
        return completionResult.data;
    }
}
// ponytail: convert parser's FaraActionArgs shape (nested coordinates/viewport)
// to wire ExecutableActionV1 shape (flat x/y) that downstream consumers expect.
// Also threads `reasoning`, `finalAnswer` (for terminate), and `memoryUpdates`
// (optional on every action) so the harness can surface them in the side panel
// and merge memory.
function toExecutableAction(parsed) {
    const a = parsed;
    const reasoning = typeof a.reasoning === "string" ? a.reasoning : "";
    const clientText = typeof a.clientText === "string" && a.clientText.length > 0 ? a.clientText : undefined;
    const memoryUpdates = validateMemoryUpdates(a.memoryUpdates);
    // ponytail: base helper now carries clientText when present so every action
    // type preserves the user-facing one-line update.
    const base = (obj) => {
        const out = { ...obj };
        if (memoryUpdates.length > 0)
            out.memoryUpdates = memoryUpdates;
        if (clientText !== undefined)
            out.clientText = clientText;
        return out;
    };
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
            return memoryUpdates.length > 0 ? { ...a, memoryUpdates } : a;
    }
}
//# sourceMappingURL=openai-compatible-planner.js.map