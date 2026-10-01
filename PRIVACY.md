# Brotto Privacy Policy

**Effective date:** 2026-10-01

Brotto has a single purpose:

> **Let you ask an AI to perform tasks in your own logged-in browser.**

Everything below describes what that purpose requires and nothing more.

This policy explains what Brotto does with data. It describes two deployment modes, because the answer
is different for each:

- **Self-hosted** — you run the orchestrator yourself. The server is software on your own machine, so
  "the server" below means your machine.
- **Hosted** — you connect the extension to a Brotto-operated server. The server is operated by us.

If you do not know which mode you are in, you are self-hosted: nothing is sent to us unless you
explicitly configured a server address that is not your own.

## Summary

Brotto is built so that we collect as little as possible. There is no analytics, no telemetry, no
advertising, no tracking across sites, and we do not sell or share data with anyone for marketing. The
data that moves during a task is the data the task inherently requires: what the page looks like to a
computer, and the model provider you chose.

**Your model API key is never written to disk by Brotto.** It is held in memory and used to call your
model provider.

## What the extension stores on your device

| Data | Where | Lifetime |
|---|---|---|
| Model configuration (provider, model name, context window) | `chrome.storage.local` | Until you clear it |
| **Your model API key** | `chrome.storage.session` | **Memory only.** Cleared when the browser closes. Never written to disk by the extension. |
| Your policy (blocked domains, sensitive-action list) | `chrome.storage.local` | Until you clear it |
| Session ID for the conversation | `chrome.storage.session` | Until the browser closes |

Because the key lives in `chrome.storage.session`, it is not written to disk by Chrome and is gone when
the browser exits. You will be asked for it again next session.

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

The orchestrator then sends **the page observations to the model provider you selected** — Anthropic,
OpenAI, or MiniMax. This is the core of what a browser agent does: the model has to see the page in
order to act on it. Which provider receives it is entirely your choice, and that choice determines which
company's privacy policy governs that data.

**In self-hosted mode, none of this reaches us.** In hosted mode, the key and the page observations pass
through our server in order to reach your model provider.

## What the orchestrator writes to disk

| File | Contents |
|---|---|
| `logs/sessions/<session_id>.json` | The audit record of your conversation: your messages, each step's observation, the prompts, the actions taken, approvals, timing, and errors. |
| `logs/user_models/<client>.json` | Your model configuration (provider and model name). **Not your key.** |
| `logs/user_policies/` | Your blocked-domains list. |

**Page text is never written to disk.** Each step's page is recorded as a 200-character digest, so a run
over an authenticated session leaves a record of *what* was visited and not copies of *what was on it*.
A run resumed later recalls those digests rather than whole pages — that is the trade for keeping your
pages off the filesystem, and it is not configurable.

Values typed into a field the orchestrator identifies as a secret — anything with
`type="password"`, or an accessible name that reads like a credential — are **redacted before the
record is written**, so they are not stored in the audit file.

Your client address is used to key your local policy and model-configuration files, so that separate
users on the same server do not share settings. It is not used for advertising or analytics.

## Suggestions on an idle page (optional)

If you leave the side panel open on a page with no task running, Brotto can read that page's **visible
text**, URL, and title and send them to your model provider to suggest something you might want to do.
No action is taken on the page, and nothing is stored beyond the suggestion itself.

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

Anthropic, OpenAI and MiniMax each have their own privacy policy and terms governing what they receive
and how long they keep it. Those terms are between you and them.

## Retention and deletion

- **Audit records** are written to disk by the orchestrator and are retained until you delete them.
  Delete the file, or delete the `logs/` directory, to remove a conversation permanently.
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
