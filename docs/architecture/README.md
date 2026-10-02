# Architecture notes

The long-form "we tried X, it failed because Y" behind each subsystem. `CLAUDE.md`
carries the operative rules and constants; these files carry the reasoning, so a
wrong fix is not re-derived a second time.

| File | Read before touching |
|---|---|
| `model-config.md` | `model/`, dev-mode env defaults, provider settings, key resolution |
| `agent-loop.md` | `agent/harness.py`, `agent/prompt.py`, `ax_filter.py`, `retries`/validation |
| `conversation.md` | `agent/audit.py`, `main.py` WS frames, resume/reconnect, replay |
| `suggestions.md` | `agent/suggest.py`, `POST /v1/suggestions`, panel suggestion box |
| `panel-ui.md` | `sidepanel.js` rendering, cards, `renderMarkdown`, history rows |
| `extension.md` | `background.ts`, `debugger.ts`, policy, notifications, storage |
| `privacy.md` | anything touching user content: audit documents, `.pages.json`, metrics, retention |
| `deployment.md` | the self-host image, env vars, TLS, VM sizing, the launch gates |
