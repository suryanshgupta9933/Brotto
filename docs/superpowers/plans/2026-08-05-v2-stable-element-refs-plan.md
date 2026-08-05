# v2 Plan: Stable Element Refs + Accessibility Tree

## Goal

Upgrade the browser extension to capture DOM elements with **stable references** that persist across page states, enabling deterministic workflow recording and self-healing replay.

## Problem Statement

Current `semanticTargets` use opaque UUID `targetId` values that change every observation. Element matching relies on bounding-box coordinates + accessible name — fragile when:
- Elements shift slightly due to dynamic content
- Multiple similar elements exist (e.g., rows in a table)
- Page updates between observation and action

## Approach

### 1. Accessibility Tree Capture (Priority: High)

**Why**: Pierces shadow DOM and iframe boundaries that DOM-only traversal cannot reach.

```
Chrome Debugger API → accessibility.getFullAXTree(perfMode: "deep")
```

- `AXNode` provides `nodeId`, `role`, `name`, `value`, `description`
- Child nodes traverse into shadow roots and cross-origin frames
- Accessible name computation already handles ARIA labels, alt text, etc.

**Deliverable**: New `collectAccessibilitySnapshot()` in `observation.ts`
- Returns `AccessibilitySnapshot` with flattened node list
- Each node has `axNodeId`, `role`, `name`, `value`, `attributes`, `bounds`
- Nodes are ordered (preorder traversal)

### 2. Stable Element Refs via AX Path + Attribute Hash (Priority: High)

**Why**: Deterministic reference that survives page mutations.

```
Ref = SHA256(AXPath + Role + Name + KeyAttributes)
```

**AX Path**: List of `{role, position, name}` tuples from root to node
- Example: `[/Document, /Table[0], /Row[2], /Cell[1], /Button[0]("Submit")`

**Key Attributes**: `id`, `aria-label`, `data-testid`, `data-id`, `name`, `type` (selective)

**Self-healing fallback**: If exact ref not found, fuzzy match by:
1. Same AX path prefix (deepest common ancestor)
2. Same role + nearest name
3. Model-guided fallback

**Deliverable**: `StableRef` class in `observation.ts`
```typescript
interface StableRef {
  axPath: AXTuple[]
  attributeHash: string
  lastSeenBounds: Rect
  lastSeenName: string
}
```

### 3. Ref-Based Target Matching (Priority: High)

Replace `verifyDeclaredTarget()` coordinate check with `StableRef.match()`:

```typescript
match(observedSnapshot: AccessibilitySnapshot): MatchResult {
  // 1. Find node by AX path
  // 2. Verify attribute hash (tolerance for minor changes)
  // 3. Verify bounds (tolerance: ±5px)
  // 4. Return confidence score
}
```

### 4. Observation Pipeline Upgrade (Priority: Medium)

```
collectPageSnapshot()     → DOM-based semanticTargets (backward compat)
collectAccessibilitySnapshot() → AXTree-based snapshot (new)
```

Both run in parallel on observation. Controller receives unified `Observation` with both `semanticTargets` (legacy) and `accessibilityNodes` (new).

## Implementation Order

1. `collectAccessibilitySnapshot()` — new function, returns `AccessibilityNode[]`
2. `StableRef` class — AX path computation, hash, match logic
3. Update `Observation` type to include `accessibilityNodes`
4. Update `verifyDeclaredTarget()` to use `StableRef.match()`
5. Self-healing fallback in `executeAction()` when ref not found
6. Integration test with dynamic page (elements shift after load)

## Files to Modify

- `clients/browser-extension/src/canonical/observation.ts` — ~300 new lines
- `clients/browser-extension/src/canonical/action-executor.ts` — update target matching
- `clients/browser-extension/src/canonical/types.ts` — add `AccessibilityNode`, `StableRef`

## Verification

- [ ] Accessibility tree pierces shadow DOM in test pages
- [ ] StableRef.hash() is deterministic across same-element captures
- [ ] StableRef.match() finds element after minor page mutation
- [ ] Self-healing fallback triggers when ref not found
- [ ] No regression in existing canonical loop tests

## Notes

- AXTree is expensive on large pages — use `perfMode: "deep"` with throttling
- AXNode IDs change per capture — must use path-based matching, not nodeId
- Consider caching AXTree for 100ms window to avoid duplicate captures
