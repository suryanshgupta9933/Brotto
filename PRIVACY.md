# Brotto Privacy Policy

**Effective date:** 2026-10-03

Brotto has a single purpose:

> **Let you ask an AI to perform tasks in your own logged-in browser.**

Everything below describes what that purpose requires and nothing more.

This policy explains what Brotto does with data.

Brotto has one deployment. **You run the orchestrator.** It is open-source software you install on
your own machine or your own server, and the extension talks to whatever address you type into its
settings. There is no Brotto-operated service, we run no servers, and "the server" below means the
machine you chose to run it on.

That is the whole privacy story, and it is worth being precise about it: whoever operates the machine
the orchestrator runs on can read the pages the agent reads. There is no operator between the agent and
your documents in this product, because there is no operator at all. It is a property of the
deployment, not a promise from us.

If you would rather not trust anyone with that — including yourself in six months — do not have an
agent work on pages you would not paste into a chat window.

## Summary

Brotto is built so that we collect as little as possible. There is no analytics, no telemetry, no
advertising, no tracking across sites, and we do not sell or share data with anyone for marketing. We
do not operate the server, so we do not receive your data. The data that moves during a task is the
data the task inherently requires: what the page looks like to a computer, and the model provider you
chose.

**Your model API key is never written to disk by Brotto.** It is held in memory and used to call your
model provider.

## What the extension stores on your device

| Data | Where | Lifetime |
|---|---|---|
| Model configuration (provider, model name, context window) | `chrome.storage.local` | Until you clear it |
| **Your model API key** | `chrome.storage.session` | **Memory only.** Cleared when the browser closes. Never written to disk by the extension. |
| **Your server secret** (`AGENT_SECRET`) | `chrome.storage.local` | Until you clear it. It authorizes reading every transcript on your server, so treat it like a password. |
| An install id — a random identifier generated once, with no relationship to you, your machine, or your network | `chrome.storage.local` | Until you clear it |
| Your policy (blocked domains, sensitive-action list) | `chrome.storage.local` | Until you clear it |
| Session ID for the conversation | `chrome.storage.session` | Until the browser closes |
| The address of the server you are connected to | `chrome.storage.local` | Kept until you change it |
| The last page URL the agent saw | `chrome.storage.session` | Cleared when the browser closes |
| A running transcript of the current task — your messages, the cards Brotto is showing you | `chrome.storage.session` | Cleared when the browser closes |

Because the key lives in `chrome.storage.session`, it is not written to disk by Chrome and is gone when
the browser exits. You will be asked for it again next session.

The server address and the last page URL are the two rows worth a second look: both name a page you
were on, and the server address names the machine that ran your agent.

## What leaves your device during a task

When you start a task, the extension sends to the orchestrator:

1. **Your model API key and model configuration.** The orchestrator needs the key to call your model
   provider. It holds it in memory for the duration of the task.
2. **The page you are looking at**, as the machine sees it: the page URL, the page title, the
   accessibility tree of interactive elements (role, accessible name, value, and a stable reference for
   each), and visible page text when the task calls for it.

**Page text is redacted before it is sent.** Before any page text reaches the model, the orchestrator
removes credentials, API keys, bearer tokens, payment card numbers and government identifiers, replacing
each with `[redacted]`. This happens in code, on your machine, on every task, with no setting to turn it
off — and on the suggestions path too, which reads a page with no task running and is the easiest place
for this to be forgotten. It is pattern matching, not a guarantee: it will miss an unfamiliar identifier format, and it will
occasionally redact an innocuous number that happens to pass a checksum. The agent is told the redaction
already happened and is instructed not to try to reconstruct a redacted value.

The orchestrator then sends **the page observations to the model provider you selected**. Brotto ships
with Anthropic, OpenAI, MiniMax, Gemini, OpenRouter, DeepSeek and Groq, and can be pointed at a
compatible endpoint of your own. This is the core of what a browser agent does: the model has to see the
page in order to act on it. Which provider receives it is entirely your choice, and that choice
determines which company's privacy policy governs that data. If you point Brotto at your own endpoint,
that data goes to your own machine and no model company sees it at all.

**None of this reaches us.** The orchestrator is software on your machine, so both the key and the page
observations go from your browser to your machine and on to your model provider. The observations do
not stop at the model call, though: the server saves the URL, the page title, and a short digest of
each page to a file on its own disk, and that file is still there after the task ends. The next section
says exactly what is in it.

## What the orchestrator writes to disk

| File | Contents |
|---|---|
| `logs/sessions/<session_id>.json` | The audit record of your conversation: your messages, the page URL and title at each step, the prompts, the actions taken, approvals, timing, and errors. It also holds the text you **typed** into a field, and the model's own written reasoning about what it saw. For the page itself it keeps counts and a summary of what changed — not the whole tree. |
| `logs/sessions/<session_id>.scratchpad.txt` | The agent's working memory: a short digest of each captured page and its URL. |
| `logs/user_models/<install-id>.json` | Your model configuration: provider, model name, context window, and the address of your provider's API if you set a custom one. **Not your key.** If that address is on your own network, it is written to disk in the clear. |
| `logs/user_policies/<hash>.json` | Your blocked-domains list; the sites you have approved Brotto to work on; and when you last saved it. |

**The page itself is never written to disk — but the record of it is not empty.** Each step's page is
recorded as a 200-character digest, so a run over an authenticated session leaves a record of *what* was
visited and not copies of *what was on it*. Two things about that step survive on disk in full: **the text
you typed** (only fields that look like credential fields are masked), and **the model's own prose about
the page**, which is its paraphrase rather than a copy. A run over your mail or your documents therefore
leaves readable traces of both.
A run resumed later recalls those digests rather than whole pages — that is the trade for keeping your
pages off the filesystem, and it is not configurable.

Values typed into a field the orchestrator identifies as a secret — anything with `type="password"`, or
a field whose name reads like a credential, a token, or a code — are **redacted before the record is
written**, so a password you type is not stored in the audit file.

That redaction applies to what the agent *types*, and the page text that reaches the model provider is
redacted separately. What is kept on disk is narrower than either: a 200-character digest of each page.
A page that displays a token, an account number, or an email address may still put a fragment of it in
that digest. If that matters for a site you use, the safest thing is to not have the agent work on that
site.

The files are named after the install that created them, so that separate users on one server do not
share settings. That name is the random install id the extension generated on your machine — not your
name, not your IP address, and not your network. The model-configuration file is named with the install
id in plain text; the policy file is named with a scrambled version of it. It is not used for
advertising or analytics — the machine holding them is yours, and nothing is sent anywhere with it.

**The approved-sites list is a record of where you have let Brotto work.** When you approve a site in
an approval card, its domain is added to your policy file and stays there until you clear it, so you
are not asked about that site again. That means the server holds a list of the domains you have given
an agent access to. Nothing else about those sites is kept — no URLs, no page content, no dates of
use — and the list is yours to remove: delete the policy file, or the approved list inside it, and
every site goes back to asking. Blocking a domain is separate from approving it, and blocking one
always wins.

One caveat worth knowing rather than guessing at: the server also accepts an identifier a client can
supply in place of that install id, and it will use that instead. The Brotto extension supplies its own
install id, so that is what is used. A client that sends something else — or nothing at all — falls back
to the connection's address. It is mentioned here because it is a real property of the software, not
because you should expect to meet it.

## Suggestions on an idle page (optional)

If you leave the side panel open on a page with no task running, Brotto can read that page's **visible
text**, URL, and title and send them to suggest something you might want to do. That request goes to
the orchestrator and on to your model provider, so the same page text leaves your machine here as it would
during a task. No action is taken on the page, and no file is written for it — the suggestion is
held in the panel's memory, which is discarded when the browser closes.

This reads a page you are looking at without a task in flight. **It is off unless you turn it on**, and
we are calling it out here rather than relying on you noticing a change. If you would rather it did not
exist, do not enable it.

Two things narrow what it will read. Pages whose address looks like a login, checkout, payment or account
settings screen are skipped before the read, and a page carrying a password, card or one-time-code field
is skipped even when its address looks ordinary. The panel shows a **"Reading page"** badge for exactly
as long as a read is in progress, so the read is visible while it happens.

## Third parties

The only third party that receives your page data is **the model provider you selected**. Brotto does
not share data with analytics providers, advertising networks, data brokers, or social platforms.

The model providers we support — Anthropic, OpenAI, MiniMax, Gemini, OpenRouter, DeepSeek and Groq —
each have their own privacy policy and terms governing what they receive and how long they keep it.
Those terms are between you and them, and we do not control them. Your orchestrator is also a party to
this data, in the sense that it holds the page observations in memory while it waits for the model to
answer.

## Retention and deletion

Nothing expires on a timer. **Deletion is entirely yours**, and it is immediate:

- **Session records** — the audit file and the scratchpad, described above — are written to disk and
  stay there until you remove them. Nothing expires on a schedule unless you ask for it: the server has
  a `BROTTO_RETENTION_DAYS` setting that will age sessions out, and it is **off by default**.
  - **In the panel:** each conversation in **Session history** has a delete button, and there is a
    **Delete all** above the list. Both ask you to confirm first — the question names the conversation
    by its own first message, or names how many are about to go. There is no undo.
  - **On the server:** `curl -X DELETE -H "Authorization: Bearer $AGENT_SECRET" \
    http://localhost:8000/v1/sessions/<id>` removes one; `DELETE /v1/sessions` removes every one.
    The files live in `logs/sessions/`, so removing them by hand works exactly the same way.
- **Local extension data** is removed by clearing the extension's storage, or by uninstalling it.
- **Deleting sessions does not delete your settings.** `DELETE /v1/sessions` and the panel's **Delete
  all** cover the session records only. Your blocked-domains list and your **approved-sites list**
  (`logs/user_policies/`) and your model configuration (`logs/user_models/`) are separate files, keyed by
  your install id, and survive. If you want the approved-sites list gone — which is the one that records
  which domains you have let an agent work on — delete that file by hand, or clear the approved list
  inside the panel's policy screen.
- **Your API key** is not retained by Brotto anywhere. It is held in the orchestrator's memory for the
  duration of a task and not written to disk.

## Security

- The extension communicates with the orchestrator over WebSocket, and with your model provider over
  that provider's HTTPS API.
- The extension requests `chrome.debugger` to read the accessibility tree and dispatch input, and
  `<all_urls>` host access so it can work on the site you name. Both are exercised only during a task
  you started.
- Brotto always asks for approval before sensitive actions (sending email, payments, deletes,
  publishing, changing passwords, and similar), and always asks before acting on a site for the first
  time. There is no setting that turns either off.
- The blocked-domains list is yours alone. There is no server-side floor, so nothing Brotto's operators
  configure can add a site you did not block yourself.

**The endpoints are authenticated, and the bind address is the other half of that.** The server requires
an `AGENT_SECRET` you set yourself, and the extension sends it as a WebSocket subprotocol rather than in
the URL — a `?token=` would write your secret in plain text into the access log of your server and of
any proxy in front of it. With the secret unset, every caller is treated as trusted and the server says
so in its startup log, so if you expose the port to a network, set the secret first. The default
`docker compose` binds to `127.0.0.1` for exactly this reason.

One endpoint is deliberately left open, and it is not a session one: `POST /run` launches a headless
browser with no authentication. Do not put it on a public interface. `/health` is also unauthenticated
because the container's own healthcheck needs it; it reports that the service is up and which model is
resolved, and nothing else.

No system is perfect. A browser agent operating with your session has the same access you do, and a
compromise of the extension or the server would have the same effect. Do not use it on accounts where
that risk is unacceptable.

## Children

Brotto is not directed at children under 13.

## Changes to this policy

Material changes will be noted in the repository's commit history and dated at the top of this file.

## Contact

Questions about this policy: open an issue in the repository.
