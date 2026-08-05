# Task 10 Report: Deterministic canonical-loop and security gate

## Outcome

Implemented a deterministic, no-network, no-Chrome release gate for the canonical browser-agent loop and closed the composition gaps it exposed.

- Added a scripted client, clock, inference, policy, persistence, trajectory, and terminal sink under `evals/canonical-loop`.
- Proved blank page → navigation → search/results → evidence-backed completion with exact trajectory order, one in-flight command, observation/action linkage, and one structured terminal message.
- Made client acknowledgement a distinct durable event. Dispatch no longer impersonates ACK, results cannot precede the real signed ACK, ACK lineage includes the client sequence, and replays do not duplicate effects or audit events.
- Added a durable terminal outbox to the session model. Terminal payload identity and sequence survive delivery loss; reconnect replays the same signed terminal until a receipt watermark proves it was received.
- Added signed terminal delivery to `AgentTransportHub`, including authoritative bidirectional cancellation confirmation.
- Added authenticated browser-session bootstrap. A trusted device/pairing authenticator issues a short-lived one-time JWT and per-session HMAC key bound to tenant/device/session/credential/expiry. The WSS route atomically consumes the credential, resolves the bound signer, and rejects replay, wrong origin, wrong device, guessed session, and expiry.
- Required a bootstrap session-store interface for credential consumption and signer resolution. The provided in-memory implementation is explicitly development-only; production composition cannot combine bootstrap with a static envelope verifier.
- Kept cancellation observation linkage optional so cancellation before the first observation remains representable.

## Deterministic and adversarial coverage

The canonical eval now covers:

- full observation → inference → policy → command → actual client ACK → result → settled observation → verified terminal flow;
- ACK/result reorder, stale binding, exact message/result replay, command and terminal delivery loss, reconnect, and receipt proof;
- malformed inference, speculative completion, deterministic no progress, policy denial, terminal action failure, and cancellation exactly once;
- malformed wire, missing/forged signatures, expired and oversized envelopes, recipient mismatch, sequence replay, and tenant/device/session binding attacks;
- pairing proof rejection, wrong origin, guessed/wrong device binding, one-time credential replay, expired token, and signed WSS bootstrap;
- forbidden cookie, authorization, local/session storage, password, and profile keys at arbitrary nested object/array depth;
- unsafe URL, private/metadata destination, DNS rebinding, missing local approval proof, stale observation approval, exact active-tab/main-frame capture, opaque tab/frame identifiers, and oversized screenshot rejection.

No test uses external network access, Chrome, or a live model.

## TDD and final verification

The initial tests exposed missing ACK routing, result admission without ACK, absent terminal transport/outbox state, and absent authenticated bootstrap. Those tests were made green through public production ports and persistence state, without test-only branches.

```text
canonical-loop eval (intact local Jest binary)
2 suites, 20 tests passed

agent orchestrator
11 suites, 234 tests passed

browser extension
14 suites, 195 tests passed

relay protocol
6 suites, 86 tests passed

fara-action-schema TypeScript build
exit 0

relay-protocol TypeScript build
exit 0

agent-orchestrator TypeScript build
exit 0

browser-extension TypeScript build
exit 0
```

## Existing suite/tooling limitation

The required pnpm command forms trigger pnpm 11's shared dirty-worktree dependency-status check, which attempts an interactive module purge. One such check partially removed the orchestrator dependency tree, so final verification intentionally used the intact frozen local binaries and did not install or download anything.

The pre-existing `evals/contract` suite is not green independently of Task 10: its ts-jest configuration cannot see Jest globals in this workspace invocation, and its legacy MCP tests target obsolete `McpToolName` members and pre-canonical action shapes. It failed before executing tests. The current canonical relay contract is separately covered by the green 86-test relay-protocol suite and the 20-test Task 10 gate.

Generated `node_modules`, lockfiles, and `dist` trees are not Task 10 deliverables and must not be staged.

## Intended source staging scope

- `.superpowers/sdd/2026-08-03-canonical-agent-loop-plan/task-10-report.md`
- `evals/canonical-loop/.npmrc`
- `evals/canonical-loop/package.json`
- `evals/canonical-loop/pnpm-workspace.yaml`
- `evals/canonical-loop/jest.config.js`
- `evals/canonical-loop/helpers/fakes.ts`
- `evals/canonical-loop/simulated-client.test.ts`
- `evals/canonical-loop/security.test.ts`
- `package.json`
- `turbo.json`
- `packages/fara-action-schema/src/v1/events.ts`
- `packages/fara-action-schema/tsconfig.json`
- `packages/relay-protocol/src/v1/messages.ts`
- `packages/relay-protocol/src/v1/secure-ingress.ts`
- `services/agent-orchestrator/src/app.ts`
- `services/agent-orchestrator/src/index.ts`
- `services/agent-orchestrator/src/engine/types.ts`
- `services/agent-orchestrator/src/engine/session-engine.ts`
- `services/agent-orchestrator/src/transport/auth.ts`
- `services/agent-orchestrator/src/transport/bootstrap.ts`
- `services/agent-orchestrator/src/transport/ws-server.ts`
- `services/agent-orchestrator/src/__tests__/canonical-engine.test.ts`
- `services/agent-orchestrator/src/__tests__/ws-reconcile.test.ts`

The relay message-schema cancellation change may already belong to Task 9's commit; stage it only if it remains unstaged after that commit.
