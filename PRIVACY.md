# Brotto Privacy Policy

**Effective date:** 2026-10-02

Brotto has a single purpose:

> **Let you ask an AI to perform tasks in your own logged-in browser.**

Everything below describes what that purpose requires and nothing more.

This policy explains what Brotto does with data. It describes two deployment modes, because the answer
is different for each:

- **Self-hosted** — you run the orchestrator yourself. The server is software on your own machine, so
  "the server" below means your machine.
- **Hosted** — you connect the extension to a Brotto-operated server. The server is operated by us,
  it runs on our hardware, and **the pages you visit are written to a file on it and kept there.**

If you do not know which mode you are in, you are self-hosted: nothing is sent to us unless you
explicitly configured a server address that is not your own.

The rest of this policy describes both modes together. Wherever it matters, it says which mode it is
talking about — because "the server writes this to disk" means something quite different when that
server is your laptop and something quite different when it is ours.

## Summary

Brotto is built so that we collect as little as possible. There is no analytics, no telemetry, no
advertising, no tracking across sites, and we do not sell or share data with anyone for marketing. The
data that moves during a task is the data the task inherently requires: what the page looks like to a
computer, and the model provider you chose.

Two things in this policy are worth reading even if you read nothing else, because they are the
difference between self-hosted and hosted:

- In **hosted** mode, we receive what the agent reads off your screen, and the server writes it to a
  file that stays on our disk. It is not a stream we relay and forget.

**Your model API key is never written to disk by Brotto, in either mode.** It is held in memory and
used to call your model provider.

## What the extension stores on your device

| Data | Where | Lifetime |
|---|---|---|
| Model configuration (provider, model name, context window) | `chrome.storage.local` | Until you clear it |
| **Your model API key** | `chrome.storage.session` | **Memory only.** Cleared when the browser closes. Never written to disk by the extension. |
| Your policy (blocked domains, sensitive-action list) | `chrome.storage.local` | Until you clear it |
| Session ID for the conversation | `chrome.storage.session` | Until the browser closes |
| The address of the server you are connected to | `chrome.storage.session` | Kept until you change it |
| The last page URL the agent saw | `chrome.storage.session` | Cleared when the browser closes |
| A running transcript of the current task — your messages, the cards Brotto is showing you | `chrome.storage.session` | Cleared when the browser closes |

Because the key lives in `chrome.storage.session`, it is not written to disk by Chrome and is gone when
the browser exits. You will be asked for it again next session.

The server address and the last page URL are the two rows worth a second look if you are hosted: both
name a page you were on, and the server address tells us which Brotto server you are on.

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
off. It is pattern matching, not a guarantee: it will miss an unfamiliar identifier format, and it will
occasionally redact an innocuous number that happens to pass a checksum. The agent is told the redaction
already happened and is instructed not to try to reconstruct a redacted value.

The orchestrator then sends **the page observations to the model provider you selected**. Brotto ships
with Anthropic, OpenAI, MiniMax, Gemini, OpenRouter, DeepSeek and Groq, and can be pointed at a
compatible endpoint of your own. This is the core of what a browser agent does: the model has to see the
page in order to act on it. Which provider receives it is entirely your choice, and that choice
determines which company's privacy policy governs that data. If you point Brotto at your own endpoint,
that data goes to your own machine and no model company sees it at all.

**In self-hosted mode, none of this reaches us.** In hosted mode, both the key and the page
observations reach our server in order to get to your model provider — and the observations do not stop
there. Our server saves the URL, the page title, and a short digest of each page to a file on its own
disk, and that file is still there after the task ends. The next section says exactly what is in it.

## What the orchestrator writes to disk

| File | Contents |
|---|---|
| `logs/sessions/<session_id>.json` | The audit record of your conversation: your messages, the page URL and title at each step, the prompts, the actions taken, approvals, timing, and errors. For the page itself it keeps counts and a summary of what changed — not the whole tree. |
| `logs/sessions/<session_id>.scratchpad.txt` | The agent's working memory: a short digest of each captured page and its URL. |
| `logs/user_models/<client>.json` | Your model configuration: provider, model name, context window, and the address of your provider's API if you set a custom one. **Not your key.** If that address is on your own network, it is written to disk in the clear. |
| `logs/user_policies/<hash>.json` | Your blocked-domains list; the sites you have approved Brotto to work on; and when you last saved it. |

**Page text is never written to disk.** Each step's page is recorded as a 200-character digest, so a run
over an authenticated session leaves a record of *what* was visited and not copies of *what was on it*.
A run resumed later recalls those digests rather than whole pages — that is the trade for keeping your
pages off the filesystem, and it is not configurable.

Values typed into a field the orchestrator identifies as a secret — anything with `type="password"`, or
a field whose name reads like a credential, a token, or a code — are **redacted before the record is
written**, so a password you type is not stored in the audit file.

That redaction applies to what the agent *types*, and the page text that reaches the model provider is
redacted separately. What is kept on disk is narrower than either: a 200-character digest of each page.
A page that displays a token, an account number, or an email address may still put a fragment of it in
that digest. If that matters for a site you use, the safest thing is to run self-hosted, or not to have
the agent work on that site.

The files are named after the connection that created them, so that separate users on one server do not
share settings. That name is derived from your client address. The model-configuration file is named
with the address in plain text; the policy file is named with a scrambled version of it. In hosted mode,
that means the server holds a record of which address used it. It is not used for advertising or
analytics.

**The approved-sites list is a record of where you have let Brotto work.** When you approve a site in
an approval card, its domain is added to your policy file and stays there until you clear it, so you
are not asked about that site again. That means a hosted server holds a list of the domains you have
given an agent access to. Nothing else about those sites is kept — no URLs, no page content, no dates
of use — and the list is yours to remove: delete the policy file, or the approved list inside it, and
every site goes back to asking. Blocking a domain is separate from approving it, and blocking one
always wins.

One caveat worth knowing rather than guessing at: the server also accepts an identifier a client can
supply in place of your address, and it will use that instead. The Brotto extension does not send one
today, so your address is what is used. It is mentioned here because it is a real property of the
software, not because you should expect to meet it.

## Suggestions on an idle page (optional)

If you leave the side panel open on a page with no task running, Brotto can read that page's **visible
text**, URL, and title and send them to suggest something you might want to do. That request goes to
the orchestrator and on to your model provider, so in hosted mode we see the same page text here as we
would during a task. No action is taken on the page, and no file is written for it — the suggestion is
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
Those terms are between you and them, and we do not control them. In hosted mode we are also a party to
this data: we hold it on our own disk for as long as the retention section above describes.

## Retention and deletion

Nothing expires on a timer. **Deletion is entirely yours**, and it is immediate:

- **Session records** — the audit file and the scratchpad, described above — are written to disk and
  stay there until you remove them. Nothing expires on a schedule.
  - **In the panel:** each conversation in **Session history** has a delete button, and there is a
    **Delete all** above the list. Both ask you to confirm first — the question names the conversation
    by its own first message, or names how many are about to go. There is no undo.
  - **On the server:** `curl -X DELETE -H "Authorization: Bearer $AGENT_SECRET" \
    http://localhost:8000/v1/sessions/<id>` removes one; `DELETE /v1/sessions` removes every one.
    The files live in `logs/sessions/`, so removing them by hand works exactly the same way.
  - **In hosted mode:** you cannot delete them yourself — they are on our disk. Ask us, using the
    contact address at the end of this policy, and we will remove them. We are not promising a time
    limit for that, because there is not one in the product today.
- **Local extension data** is removed by clearing the extension's storage, or by uninstalling it.
- **Your API key** is not retained by Brotto anywhere. In hosted mode it is held in server memory for
  the duration of a task and not written to disk.

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

**A known gap in hosted mode, stated plainly.** The server's web endpoints — including the one that
lists your conversations and the one that returns a full session record — currently ask for no
password. Anyone who can reach the server's address can read the list of sessions on it, which
includes what each task was about, and can fetch a whole session record. On a self-hosted server this
only exposes sessions to people already on your network, which is the same trust you give any other
service you run. On a hosted server it is a real weakness, and it is being fixed; we are describing it
here rather than waiting for you to find it.

No system is perfect. A browser agent operating with your session has the same access you do, and a
compromise of the extension or the server would have the same effect. Do not use it on accounts where
that risk is unacceptable.

## Children

Brotto is not directed at children under 13.

## Changes to this policy

Material changes will be noted in the repository's commit history and dated at the top of this file.

## Contact

Questions about this policy: open an issue in the repository, or use the contact address published with
the hosted service.
