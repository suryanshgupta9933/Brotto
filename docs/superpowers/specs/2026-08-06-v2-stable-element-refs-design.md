# v2 Design: Stable Element Refs (Plan 1 Only)

**Date:** 2026-08-06
**Status:** Draft for review
**Scope:** Plan 1 from `docs/superpowers/plans/2026-08-05-v2-stable-element-refs-plan.md`. Plan 2 (workflow recording/replay) is deferred.

## Goal

Add deterministic, mutation-tolerant element references to the canonical observation pipeline so action verification survives minor DOM drift.

## Non-Goals

- Workflow recording, export, replay (plan 2)
- CLI converter
- AXTree caching
- Model-guided fallback
- Drop DOM-based `semanticTargets` (kept for backward compat)

## Architecture

`captureObservation()` runs DOM capture and AX tree capture in parallel (`Promise.all`), merges into one `ObservationV1` with new `accessibilityNodes` field. Action verification (`verifyDeclaredTarget`) tries `StableRef.match()` first; falls back to existing coordinate check.

```
[CanonicalExtensionController]
   └─→ captureObservation()
         ├─→ collectDomSnapshot()          (existing)
         └─→ collectAccessibilitySnapshot() (new)
   └─→ executeAction()
         └─→ verifyDeclaredTarget()
               ├─→ StableRef.match()        (new, primary)
               └─→ coordinate fallback      (existing)
```

## Module Layout

```
clients/browser-extension/src/canonical/
├── observation.ts                UPDATED — adds AX capture merge (~360 lines)
├── ax-snapshot.ts                NEW  — AXTree capture + flattening (~120 lines)
├── stable-ref.ts                 NEW  — StableRef class (pure, ~80 lines)
├── ref-matcher.ts                NEW  — match algorithm (pure, ~100 lines)
├── action-executor.ts            UPDATED — uses ref-matcher (~10 line diff)
├── redaction.ts
├── session-store.ts
├── controller.ts
├── execution-pipeline.ts
├── transport.ts
├── client-policy.ts
├── coordinate-context.ts
└── page-settler.ts

clients/browser-extension/tests/
├── ax-snapshot.test.ts           NEW
├── stable-ref.test.ts            NEW
├── ref-matcher.test.ts           NEW
└── observation.test.ts           UPDATED — assert accessibilityNodes populated

packages/fara-action-schema/src/v1/
├── observation.ts                UPDATED — add AccessibilityNodeSchema, extend ObservationV1
├── actions.ts
├── events.ts
├── ids.ts
├── results.ts
└── index.ts

evals/contract/
└── ax-shape.test.ts              NEW — small fixture
```

**Why sibling files, not subdirectories.** Existing convention is flat `canonical/` with descriptive names. Introducing `observation/` and `refs/` directories now would force import-path rewrites throughout the codebase for zero immediate benefit. Subdirectories come in plan 2 when file count justifies them.

**Why two ref files.** `stable-ref.ts` is pure construction/hash (no I/O, easy to test). `ref-matcher.ts` is the heuristic chain (pure function, takes `AccessibilityNode[]`, returns `MatchResult`). Separating lets each be reasoned about and tested in isolation.

**Why `observation.ts` stays put.** Existing 11 importers reference `"./canonical/observation"`. Moving it breaks every import for a cosmetic win. +20 lines added in place instead.

## Components

### 1. Schema (`packages/fara-action-schema/src/v1/observation.ts`)

```typescript
export const AccessibilityNodeSchema = z.object({
  axNodeId: z.string(),
  role: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  value: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  bounds: BoundingBoxSchema.optional(),
  axPath: z.array(z.object({ role: z.string(), index: z.number(), name: z.string().optional() })),
  attributeHash: z.string(),
});

export const ObservationV1Schema = withForbiddenBrowserDataGuard(z.object({
  // ... existing fields ...
  accessibilityNodes: z.array(AccessibilityNodeSchema).optional(),  // NEW
}));
```

Additive field — existing v1 consumers unaffected by absence. Versioned schema doc updated.

### 2. `canonical/ax-snapshot.ts` (NEW, ~120 lines)

Single export: `collectAccessibilitySnapshot(tabId, sendCdpCommand): Promise<AccessibilityNode[]>`

- Calls `Accessibility.getFullAXTree` with `perfMode: "deep"`
- Flattens tree to preorder list (skip `AXNode` parent wrappers, walk children)
- For each node: compute `axPath` (parent chain → tuples), extract key attributes, compute SHA256 → `attributeHash`
- Returns `[]` on CDP failure (logs warning, never throws past caller)
- Caps at `MAX_AX_NODES = 2000`; logs and truncates with warning if exceeded
- No business logic — pure capture + flatten + hash

### 3. `canonical/observation.ts` (UPDATED, +20 lines, stays at current path)

Now an orchestrator with parallel capture:
- `captureObservation()` calls existing DOM capture + new `collectAccessibilitySnapshot()` via `Promise.all`
- Internal `captureObservationInternal` merges both into one `ObservationV1`
- All existing DOM logic preserved verbatim
- All existing exports (`ObservationSecurityError`, `CaptureObservationOptions`, etc.) unchanged

### 4. `canonical/stable-ref.ts` (NEW, ~80 lines)

Pure construction. No I/O.

```typescript
export class StableRef {
  constructor(
    public readonly axPath: AXTuple[],
    public readonly attributeHash: string,
    public readonly role: string,
    public readonly name: string,
  ) {}

  static fromAXNode(node: AccessibilityNode): StableRef { /* ... */ }

  equals(other: StableRef): boolean { /* axPath + hash match */ }

  toJSON(): { axPath: AXTuple[]; attributeHash: string } { /* ... */ }
}
```

### 5. `canonical/ref-matcher.ts` (NEW, ~100 lines)

```typescript
export interface MatchResult {
  confidence: number;     // 0.0–1.0
  node: AccessibilityNode | null;
  strategy: "exact" | "fuzzy-bounds" | "role-name" | "miss";
}

export function matchStableRef(
  ref: StableRef,
  snapshot: AccessibilityNode[],
  options?: { boundsTolerance?: number },
): MatchResult {
  // 1. exact hash + axPath
  // 2. exact hash + bounds within tolerance (default ±10px)
  // 3. same role + Levenshtein-nearest name
  // 4. miss
}
```

No external deps beyond `fara-action-schema` types. Pure function, easy to test.

### 6. `canonical/action-executor.ts` (UPDATED, +10 lines)

Only change: `verifyDeclaredTarget` first calls `matchStableRef(target.ref, observation.accessibilityNodes ?? [])`; if `confidence >= 0.8`, accept and skip coord check. Otherwise fall through to existing coord logic.

## Data Flow

1. `CanonicalExtensionController.handleAgentTurn()` calls `captureObservation()` (existing)
2. Internally: `Promise.all([collectDomSnapshot(tabId), collectAccessibilitySnapshot(tabId)])`
3. Merged `ObservationV1` sent over relay to server
4. Server returns `AgentAction` with optional `target.ref?: StableRef`
5. `verifyDeclaredTarget(target, observation)`:
   - If `target.ref` and `observation.accessibilityNodes`: `matchStableRef()`
   - If `confidence >= 0.8`: return `verified: true`
   - Else: existing coord check
6. Self-healing on miss: log + return same `verified: false` path as before; future plan 2 retry logic will hook here

## Error Handling

| Failure | Behavior |
|---|---|
| `Accessibility.getFullAXTree` throws | `accessibilityNodes: []`, log warn, continue |
| AXTree > 2000 nodes | Truncate to 2000, log warn with original count |
| AX node missing role | Skip node, log debug |
| Schema parse failure | Throw `ObservationSecurityError` (existing pattern) |
| `matchStableRef` with empty snapshot | Return `{ strategy: "miss", confidence: 0, node: null }` |
| `verifyDeclaredTarget` with no `target.ref` | Skip ref path, go straight to coords (existing behavior) |

## Code Hygiene Standards

- **No `any`.** Use `unknown` + narrowing. The existing code uses Zod schemas — match that.
- **One file = one concern.** `ax-snapshot.ts` doesn't know about match logic. `ref-matcher.ts` doesn't know about CDP. `stable-ref.ts` doesn't know about DOM.
- **Pure where possible.** `StableRef` and `matchStableRef` are pure — testable without mocks.
- **No new abstractions.** No factory, no interface-with-one-impl. Classes only where state + behavior belong together (`StableRef`).
- **Constants named, not magic.** `MAX_AX_NODES = 2000`, `DEFAULT_BOUNDS_TOLERANCE_PX = 10`, `MATCH_CONFIDENCE_THRESHOLD = 0.8`.
- **Tests in top-level `tests/`.** Convention here is `clients/browser-extension/tests/` mirroring source names (e.g., `observation.test.ts`, `canonical-action-executor.test.ts`). New tests follow same pattern.
- **JSDoc on every exported symbol.** The existing `observation.ts` has minimal JSDoc — new modules set the bar higher.
- **Re-exports preserve paths.** `observation.ts` moves directory but `import { captureObservation } from "./canonical/observation"` continues to work via re-export from `canonical/observation/index.ts`.
- **No premature generalization.** Plan 2 will extend `refs/` with workflow refs — that's a future concern, no abstract base class now.

## Testing

| Test | Asserts |
|---|---|
| `ax-snapshot.test.ts` | Empty tree → `[]`; tree with shadow DOM child → flattened; tree > 2000 → truncated + warn; CDP error → `[]` + log |
| `stable-ref.test.ts` | `fromAXNode` determinism (same input → same hash); `equals` symmetric; `toJSON` round-trip |
| `ref-matcher.test.ts` | Exact match → confidence 1.0; bounds drift ±10px → fuzzy-bounds; renamed button → role-name; empty snapshot → miss |
| `observation.ts` updates | Existing tests pass; new assertion `accessibilityNodes.length > 0` when AXTree present |
| `evals/contract/ax-shape.test.ts` | Wire format validates against `ObservationV1Schema` |
| Integration (manual, gated) | Real Chrome page with shadow DOM — `accessibilityNodes` non-empty |

## Files Touched (~350 lines added, ~30 modified)

| File | Lines |
|---|---|
| `packages/fara-action-schema/src/v1/observation.ts` | +30 |
| `clients/browser-extension/src/canonical/ax-snapshot.ts` | +120 (new) |
| `clients/browser-extension/src/canonical/observation.ts` | +20 modified |
| `clients/browser-extension/src/canonical/stable-ref.ts` | +80 (new) |
| `clients/browser-extension/src/canonical/ref-matcher.ts` | +100 (new) |
| `clients/browser-extension/src/canonical/action-executor.ts` | +10 modified |
| `clients/browser-extension/tests/ax-snapshot.test.ts` | +60 (new) |
| `clients/browser-extension/tests/stable-ref.test.ts` | +50 (new) |
| `clients/browser-extension/tests/ref-matcher.test.ts` | +70 (new) |
| `clients/browser-extension/tests/observation.test.ts` | modified (assert accessibilityNodes) |
| `evals/contract/ax-shape.test.ts` | +30 (new) |

## Ponytail Cuts (deliberate simplifications)

- **No AXTree caching.** Each observation calls `getFullAXTree` fresh. Add 100ms cache if profiling shows it's hot. `# ponytail: no AXTree cache, add 100ms TTL when profiling shows duplication`
- **No model-guided fallback.** Heuristic chain only (exact → fuzzy-bounds → role-name). Model integration is plan 2/3 territory. `# ponytail: heuristic-only fallback, model fallback deferred`
- **No recording of `StableRef` in action protocol yet.** Plan 2 adds `targetRef` field to `RecordedStep`. v2 action protocol keeps `target` shape unchanged. `# ponytail: no targetRef in v2 action protocol, plan 2 adds it`
- **No `StableRef` round-trip in `SessionStore`.** Recording is plan 2. `# ponytail: no recording integration, plan 2`
- **No `axPath` indexing by name when names are empty.** Skip silently. Add heuristic (sibling position fallback) if evals show miss rate. `# ponytail: skip empty-name nodes, add sibling-position fallback if miss rate >5%`

## Open Questions

1. Should `accessibilityNodes` be required or optional in `ObservationV1`? Spec'd as **optional** to keep existing consumers valid.
2. Server-side: does the relay protocol need `StableRef` in `AgentAction.target` for v2, or can we keep `targetId` and add `ref` field separately? **Deferred** — action protocol unchanged in this scope.
3. Hash collision risk: SHA256 over `(axPath+role+name+keyAttrs)` is effectively zero-collision for UI elements. Accept.

## Verification Checklist

- [ ] `ObservationV1Schema` parses both old (no `accessibilityNodes`) and new (with `accessibilityNodes`) shapes
- [ ] `StableRef.fromAXNode` produces identical hash for identical captures
- [ ] `matchStableRef` returns `fuzzy-bounds` for ±10px drift, `role-name` for renamed label
- [ ] Shadow DOM test fixture produces non-empty `accessibilityNodes`
- [ ] Existing canonical pipeline tests pass unchanged
- [ ] AX capture failure does not break observation (returns valid `ObservationV1` with empty `accessibilityNodes`)
