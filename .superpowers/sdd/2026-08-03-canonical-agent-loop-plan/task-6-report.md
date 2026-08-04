# Task 6 report

## Outcome

Implemented the authenticated browser-agent WebSocket transport and closed the first independent-review findings.

- Browser-compatible short-lived JWT credential is carried in the WebSocket subprotocol, not the URL. JWT `jti` is atomically consumed through an injectable shared credential store.
- JWT claims bind tenant, device, session, audience, and expiry. Every signed envelope repeats tenant/device/session binding and mismatches fail before engine routing.
- Client ingress rejects server-originated messages. Server-emitted commands are registered as authoritative flow state before `action.completed` is admitted.
- `AgentTransportHub` provides real signed, ordered command delivery. The bounded queue applies deterministic backpressure.
- Reconciliation includes `lastSentClientSequence` and returns a signed authoritative response containing state plus the stored command, idempotent result, or an explicit fresh-observation requirement.
- Active connections use an injectable shared lease store with monotonically increasing fencing tokens, renewal, takeover, and expiry checks.
- App composition constructs exactly one transport hub and supplies it as the engine command sink; a real Fastify WebSocket test proves engine-to-socket delivery.
- Lease-owned message processing is one fenced work boundary. The engine also claims the fence in the durable session store before transitions.
- The durable session store retains the last accepted client sequence across reconnects and rejects duplicates and gaps before engine work.
- Heartbeat, message/byte rate limits, signature/schema/expiry/replay checks, and cancellation routing remain enforced.

## Verification

The repository root is not a pnpm workspace; the scoped service workspace is the canonical runnable entry point and does not modify unrelated workspace files.

```bash
cd services/agent-orchestrator
pnpm test -- --runInBand ws-auth ws-reconcile
pnpm build

cd ../../packages/relay-protocol
NODE_OPTIONS='--experimental-vm-modules' ../../services/agent-orchestrator/node_modules/.bin/jest --runInBand
../../services/agent-orchestrator/node_modules/.bin/tsc
```

Results:

- agent-orchestrator: 11 suites, 224 tests passed; TypeScript build passed.
- relay-protocol: 6 suites, 84 tests passed; TypeScript build passed.

No cookies, authorization headers, local/session storage, password values, or visited-site credentials are represented by the transport schema or logs.
