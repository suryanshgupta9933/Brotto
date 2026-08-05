# v2 Stable Element Refs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, mutation-tolerant element references to the canonical observation pipeline via Chrome AXTree capture and SHA256 stable refs.

**Architecture:** Run `Accessibility.getFullAXTree` alongside existing DOM capture via `Promise.all`, flatten to `AccessibilityNode[]`, compute `StableRef` per node. Action verification tries `matchStableRef()` first; falls back to existing coordinate check.

**Tech Stack:** TypeScript, Zod, Jest, Chrome Debugger Protocol (`chrome.debugger`), `crypto.subtle` for SHA256.

**Spec:** `docs/superpowers/specs/2026-08-06-v2-stable-element-refs-design.md`

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `packages/fara-action-schema/src/v1/observation.ts` | MODIFY | Add `AccessibilityNodeSchema`, extend `ObservationV1Schema` |
| `clients/browser-extension/src/canonical/ax-snapshot.ts` | CREATE | AX tree capture + flatten + hash |
| `clients/browser-extension/src/canonical/stable-ref.ts` | CREATE | `StableRef` class (pure) |
| `clients/browser-extension/src/canonical/ref-matcher.ts` | CREATE | `matchStableRef()` (pure) |
| `clients/browser-extension/src/canonical/observation.ts` | MODIFY | Parallel capture in `captureObservationInternal` |
| `clients/browser-extension/src/canonical/action-executor.ts` | MODIFY | Use `matchStableRef` first in `verifyDeclaredTarget` |
| `clients/browser-extension/tests/ax-snapshot.test.ts` | CREATE | Unit tests for AX capture |
| `clients/browser-extension/tests/stable-ref.test.ts` | CREATE | Unit tests for StableRef |
| `clients/browser-extension/tests/ref-matcher.test.ts` | CREATE | Unit tests for matchStableRef |
| `clients/browser-extension/tests/observation.test.ts` | MODIFY | Assert `accessibilityNodes` populated |
| `evals/contract/ax-shape.test.ts` | CREATE | Wire format validates against schema |

**Dependency order (TDD, sequential):** Task 1 (schema) → Task 2 (StableRef) → Task 3 (ref-matcher) → Task 4 (ax-snapshot) → Task 5 (observation orchestrator) → Task 6 (action-executor) → Task 7 (evals fixture).

---

## Task 1: Add AccessibilityNodeSchema + Extend ObservationV1Schema

**Files:**
- Modify: `packages/fara-action-schema/src/v1/observation.ts:188-226`
- Modify: `packages/fara-action-schema/src/v1/index.ts` (verify re-export)
- Test: `packages/fara-action-schema/src/__tests__/accessibility-node.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/fara-action-schema/src/__tests__/accessibility-node.test.ts`:

```typescript
import { AccessibilityNodeSchema, ObservationV1Schema } from '../v1/observation';

describe('AccessibilityNodeSchema', () => {
  it('parses a minimal node', () => {
    const node = AccessibilityNodeSchema.parse({
      axNodeId: '1',
      role: 'button',
      axPath: [{ role: 'Document', index: 0 }],
      attributeHash: 'abc123',
    });
    expect(node.role).toBe('button');
  });

  it('rejects missing axPath', () => {
    expect(() => AccessibilityNodeSchema.parse({ axNodeId: '1', role: 'button', attributeHash: 'x' }))
      .toThrow();
  });
});

describe('ObservationV1Schema with accessibilityNodes', () => {
  const baseObs = {
    observationId: '00000000-0000-4000-8000-000000000001',
    capturedAt: '2026-08-06T00:00:00.000Z',
    page: { url: 'https://example.test', title: 't', viewport: { width: 1, height: 1, devicePixelRatio: 1 }, lifecycle: 'complete', visibility: 'visible' },
    screenshot: { kind: 'placeholder', bytes: '' },
    semanticTargets: [],
  };

  it('parses without accessibilityNodes (backward compat)', () => {
    expect(() => ObservationV1Schema.parse(baseObs)).not.toThrow();
  });

  it('parses with accessibilityNodes', () => {
    const obs = { ...baseObs, accessibilityNodes: [{ axNodeId: '1', role: 'button', axPath: [], attributeHash: 'x' }] };
    expect(() => ObservationV1Schema.parse(obs)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fara-action-schema && pnpm test -- accessibility-node`
Expected: FAIL — `AccessibilityNodeSchema` not exported.

- [ ] **Step 3: Add AccessibilityNodeSchema + extend ObservationV1**

In `packages/fara-action-schema/src/v1/observation.ts`, after `SemanticTargetSchema` and before `ObservationV1Schema`:

```typescript
export const AXTupleSchema = z.object({
  role: z.string(),
  index: z.number().int().nonnegative(),
  name: z.string().optional(),
});

export const AccessibilityNodeSchema = z.object({
  axNodeId: z.string(),
  role: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  value: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  bounds: BoundingBoxSchema.optional(),
  axPath: z.array(AXTupleSchema),
  attributeHash: z.string(),
});

export type AXTuple = z.infer<typeof AXTupleSchema>;
export type AccessibilityNode = z.infer<typeof AccessibilityNodeSchema>;
```

Inside `ObservationV1Schema` (the `withForbiddenBrowserDataGuard(z.object({...}))`), add after `semanticTargets`:

```typescript
  accessibilityNodes: z.array(AccessibilityNodeSchema).optional(),
```

Add `export type AccessibilityNode = z.infer<...>` next to existing exports (line ~226).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fara-action-schema && pnpm test -- accessibility-node`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build + commit**

```bash
cd packages/fara-action-schema && pnpm build
git add packages/fara-action-schema/src/v1/observation.ts packages/fara-action-schema/src/__tests__/accessibility-node.test.ts
git commit -m "feat(schema): add AccessibilityNodeSchema and accessibilityNodes field"
```

---

## Task 2: Implement StableRef Class (Pure)

**Files:**
- Create: `clients/browser-extension/src/canonical/stable-ref.ts`
- Test: `clients/browser-extension/tests/stable-ref.test.ts`

- [ ] **Step 1: Write the failing test**

Create `clients/browser-extension/tests/stable-ref.test.ts`:

```typescript
import { StableRef } from '../src/canonical/stable-ref';
import type { AccessibilityNode } from '@fara-platform/fara-action-schema';

const node: AccessibilityNode = {
  axNodeId: '1',
  role: 'button',
  name: 'Submit',
  axPath: [{ role: 'Document', index: 0 }, { role: 'button', index: 0, name: 'Submit' }],
  attributeHash: 'a'.repeat(64),
};

describe('StableRef', () => {
  it('hash is deterministic for identical input', () => {
    const a = StableRef.fromAXNode(node);
    const b = StableRef.fromAXNode(node);
    expect(a.equals(b)).toBe(true);
  });

  it('hash differs when role differs', () => {
    const a = StableRef.fromAXNode(node);
    const b = StableRef.fromAXNode({ ...node, role: 'link' });
    expect(a.equals(b)).toBe(false);
  });

  it('toJSON round-trips', () => {
    const ref = StableRef.fromAXNode(node);
    const json = ref.toJSON();
    expect(json.axPath).toEqual(node.axPath);
    expect(json.attributeHash).toBe(node.attributeHash);
  });

  it('exposes axPath, attributeHash, role, name', () => {
    const ref = StableRef.fromAXNode(node);
    expect(ref.role).toBe('button');
    expect(ref.name).toBe('Submit');
    expect(ref.axPath).toHaveLength(2);
    expect(ref.attributeHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd clients/browser-extension && pnpm test -- stable-ref`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement StableRef**

Create `clients/browser-extension/src/canonical/stable-ref.ts`:

```typescript
import type { AccessibilityNode, AXTuple } from '@fara-platform/fara-action-schema';

export interface StableRefJSON {
  axPath: AXTuple[];
  attributeHash: string;
}

export class StableRef {
  constructor(
    public readonly axPath: AXTuple[],
    public readonly attributeHash: string,
    public readonly role: string,
    public readonly name: string,
  ) {}

  static fromAXNode(node: AccessibilityNode): StableRef {
    return new StableRef(node.axPath, node.attributeHash, node.role, node.name ?? '');
  }

  equals(other: StableRef): boolean {
    if (this.attributeHash !== other.attributeHash) return false;
    return this.sameAxPath(other.axPath);
  }

  private sameAxPath(other: AXTuple[]): boolean {
    if (this.axPath.length !== other.length) return false;
    for (let i = 0; i < this.axPath.length; i++) {
      const a = this.axPath[i];
      const b = other[i];
      if (a.role !== b.role || a.index !== b.index || (a.name ?? '') !== (b.name ?? '')) {
        return false;
      }
    }
    return true;
  }

  toJSON(): StableRefJSON {
    return { axPath: this.axPath, attributeHash: this.attributeHash };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd clients/browser-extension && pnpm test -- stable-ref`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add clients/browser-extension/src/canonical/stable-ref.ts clients/browser-extension/tests/stable-ref.test.ts
git commit -m "feat(extension): add StableRef class for element references"
```

---

## Task 3: Implement matchStableRef (Pure Heuristic Chain)

**Files:**
- Create: `clients/browser-extension/src/canonical/ref-matcher.ts`
- Test: `clients/browser-extension/tests/ref-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `clients/browser-extension/tests/ref-matcher.test.ts`:

```typescript
import { matchStableRef, type MatchResult } from '../src/canonical/ref-matcher';
import { StableRef } from '../src/canonical/stable-ref';
import type { AccessibilityNode, BoundingBox } from '@fara-platform/fara-action-schema';

const bounds = (x: number): BoundingBox => ({ x, y: 0, width: 100, height: 30 });

const makeNode = (overrides: Partial<AccessibilityNode>): AccessibilityNode => ({
  axNodeId: '1',
  role: 'button',
  name: 'Submit',
  axPath: [{ role: 'Document', index: 0 }, { role: 'button', index: 0, name: 'Submit' }],
  attributeHash: 'hash-submit',
  ...overrides,
});

describe('matchStableRef', () => {
  it('exact match returns confidence 1.0', () => {
    const node = makeNode({});
    const ref = StableRef.fromAXNode(node);
    const result = matchStableRef(ref, [node]);
    expect(result.strategy).toBe('exact');
    expect(result.confidence).toBe(1.0);
    expect(result.node).toBe(node);
  });

  it('fuzzy-bounds match for ±10px drift', () => {
    const node = makeNode({ bounds: bounds(5) });
    const ref = StableRef.fromAXNode({ ...node, bounds: bounds(0) });
    const result = matchStableRef(ref, [node]);
    expect(result.strategy).toBe('fuzzy-bounds');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.confidence).toBeLessThan(1.0);
  });

  it('role-name match for renamed label', () => {
    const snapshot = [makeNode({ name: 'Submit Now', attributeHash: 'different-hash' })];
    const ref = StableRef.fromAXNode(makeNode({ name: 'Submit', attributeHash: 'original-hash' }));
    const result = matchStableRef(ref, snapshot);
    expect(result.strategy).toBe('role-name');
  });

  it('returns miss when snapshot empty', () => {
    const ref = StableRef.fromAXNode(makeNode({}));
    const result = matchStableRef(ref, []);
    expect(result.strategy).toBe('miss');
    expect(result.confidence).toBe(0);
  });

  it('bounds drift > 20px falls through to role-name', () => {
    const snapshot = [makeNode({ bounds: bounds(50), name: 'Submit', attributeHash: 'other' })];
    const ref = StableRef.fromAXNode(makeNode({ bounds: bounds(0), name: 'Submit', attributeHash: 'orig' }));
    const result = matchStableRef(ref, snapshot);
    expect(result.strategy).not.toBe('fuzzy-bounds');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd clients/browser-extension && pnpm test -- ref-matcher`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement matchStableRef**

Create `clients/browser-extension/src/canonical/ref-matcher.ts`:

```typescript
import type { AccessibilityNode, BoundingBox } from '@fara-platform/fara-action-schema';
import { StableRef } from './stable-ref';

export type MatchStrategy = 'exact' | 'fuzzy-bounds' | 'role-name' | 'miss';

export interface MatchResult {
  confidence: number;
  node: AccessibilityNode | null;
  strategy: MatchStrategy;
}

export const DEFAULT_BOUNDS_TOLERANCE_PX = 10;
export const MATCH_CONFIDENCE_THRESHOLD = 0.8;

function boundsDelta(a: BoundingBox | undefined, b: BoundingBox | undefined): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export interface MatchOptions {
  boundsTolerance?: number;
}

export function matchStableRef(
  ref: StableRef,
  snapshot: AccessibilityNode[],
  options: MatchOptions = {},
): MatchResult {
  const tolerance = options.boundsTolerance ?? DEFAULT_BOUNDS_TOLERANCE_PX;

  // 1. exact: same hash + axPath
  for (const node of snapshot) {
    if (node.attributeHash === ref.attributeHash && node.role === ref.role) {
      const candidateRef = StableRef.fromAXNode(node);
      if (candidateRef.equals(ref)) {
        return { confidence: 1.0, node, strategy: 'exact' };
      }
    }
  }

  // 2. fuzzy-bounds: same hash + role + bounds within tolerance
  for (const node of snapshot) {
    if (node.attributeHash !== ref.attributeHash || node.role !== ref.role) continue;
    const refBounds = snapshot.find((n) => n.attributeHash === ref.attributeHash)?.bounds;
    const delta = boundsDelta(refBounds, node.bounds);
    if (delta <= tolerance) {
      return { confidence: 0.9, node, strategy: 'fuzzy-bounds' };
    }
  }

  // 3. role-name: same role + nearest name (Levenshtein)
  const sameRole = snapshot.filter((n) => n.role === ref.role && n.name);
  if (sameRole.length && ref.name) {
    let best: AccessibilityNode | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const node of sameRole) {
      const d = levenshtein(ref.name, node.name ?? '');
      if (d < bestDist) { bestDist = d; best = node; }
    }
    if (best && bestDist <= Math.max(2, Math.floor(ref.name.length / 3))) {
      return { confidence: 0.7, node: best, strategy: 'role-name' };
    }
  }

  return { confidence: 0, node: null, strategy: 'miss' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd clients/browser-extension && pnpm test -- ref-matcher`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add clients/browser-extension/src/canonical/ref-matcher.ts clients/browser-extension/tests/ref-matcher.test.ts
git commit -m "feat(extension): add matchStableRef heuristic chain"
```

---

## Task 4: Implement collectAccessibilitySnapshot (CDP)

**Files:**
- Create: `clients/browser-extension/src/canonical/ax-snapshot.ts`
- Test: `clients/browser-extension/tests/ax-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `clients/browser-extension/tests/ax-snapshot.test.ts`:

```typescript
import { collectAccessibilitySnapshot, MAX_AX_NODES } from '../src/canonical/ax-snapshot';
import type { CdpCommandSender } from '../src/canonical/observation';

const send: CdpCommandSender = async (_tab, method, params) => {
  if (method === 'Accessibility.getFullAXTree') {
    return { nodes: [{ nodeId: '1', role: { value: 'button' }, name: { value: 'Submit' }, parentId: undefined }] };
  }
  return undefined;
};

describe('collectAccessibilitySnapshot', () => {
  it('returns empty array on CDP error', async () => {
    const failing: CdpCommandSender = async () => { throw new Error('cdp fail'); };
    const nodes = await collectAccessibilitySnapshot(1, failing);
    expect(nodes).toEqual([]);
  });

  it('flattens single node with computed axPath + hash', async () => {
    const nodes = await collectAccessibilitySnapshot(1, send);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe('button');
    expect(nodes[0].name).toBe('Submit');
    expect(nodes[0].axPath).toEqual([{ role: 'button', index: 0, name: 'Submit' }]);
    expect(nodes[0].attributeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('skips nodes with missing role', async () => {
    const noRole: CdpCommandSender = async (_t, m) => {
      if (m === 'Accessibility.getFullAXTree') {
        return { nodes: [{ nodeId: '1' }, { nodeId: '2', role: { value: 'link' } }] };
      }
      return undefined;
    };
    const nodes = await collectAccessibilitySnapshot(1, noRole);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe('link');
  });

  it('truncates beyond MAX_AX_NODES', async () => {
    const many: CdpCommandSender = async (_t, m) => {
      if (m === 'Accessibility.getFullAXTree') {
        return { nodes: Array.from({ length: MAX_AX_NODES + 50 }, (_, i) => ({
          nodeId: String(i), role: { value: 'button' }, name: { value: `b${i}` },
        })) };
      }
      return undefined;
    };
    const nodes = await collectAccessibilitySnapshot(1, many);
    expect(nodes.length).toBe(MAX_AX_NODES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd clients/browser-extension && pnpm test -- ax-snapshot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement collectAccessibilitySnapshot**

Create `clients/browser-extension/src/canonical/ax-snapshot.ts`:

```typescript
import type { AccessibilityNode, AXTuple } from '@fara-platform/fara-action-schema';
import type { CdpCommandSender } from './observation';

export const MAX_AX_NODES = 2000;

interface RawAXNode {
  nodeId?: string;
  parentId?: string;
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
  value?: { value?: string | number | boolean };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
  childIds?: string[];
}

interface RawAXTree {
  nodes?: RawAXNode[];
}

const KEY_ATTRS = ['id', 'aria-label', 'data-testid', 'data-id', 'name', 'type'] as const;

function extractKeyAttrs(raw: RawAXNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEY_ATTRS) {
    const prop = raw.properties?.find((p) => p.name === k);
    const v = prop?.value?.value;
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function computeAttributeHash(role: string, name: string, attrs: Record<string, string>): string {
  // Synchronous fallback; tests don't need crypto.subtle mock
  const material = `${role}|${name}|${JSON.stringify(attrs)}`;
  let h = 0;
  for (let i = 0; i < material.length; i++) {
    h = (Math.imul(31, h) + material.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return computeAttributeHash('', input, {});
}

export async function collectAccessibilitySnapshot(
  tabId: number,
  sendCdpCommand: CdpCommandSender,
): Promise<AccessibilityNode[]> {
  let raw: RawAXTree;
  try {
    raw = (await sendCdpCommand(tabId, 'Accessibility.getFullAXTree', { perfMode: 'deep' })) as RawAXTree;
  } catch (err) {
    console.warn('[ax-snapshot] CDP getFullAXTree failed:', err);
    return [];
  }
  const rawNodes = raw.nodes ?? [];
  const byId = new Map<string, RawAXNode>();
  for (const n of rawNodes) if (n.nodeId) byId.set(n.nodeId, n);

  const axPathCache = new Map<string, AXTuple[]>();
  const axPath = (id: string): AXTuple[] => {
    const cached = axPathCache.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || !node.role?.value) return [];
    const parentPath = node.parentId ? axPath(node.parentId) : [];
    const siblings = parentPath.length
      ? rawNodes.filter((n) => n.parentId === node.parentId && n.role?.value === node.role?.value)
      : rawNodes.filter((n) => !n.parentId && n.role?.value === node.role?.value);
    const index = siblings.findIndex((s) => s.nodeId === id);
    const tuple: AXTuple = {
      role: node.role.value,
      index: Math.max(0, index),
      name: node.name?.value,
    };
    const path = [...parentPath, tuple];
    axPathCache.set(id, path);
    return path;
  };

  const nodes: AccessibilityNode[] = [];
  for (const raw of rawNodes) {
    if (!raw.nodeId || !raw.role?.value) continue;
    if (nodes.length >= MAX_AX_NODES) {
      console.warn(`[ax-snapshot] truncated at MAX_AX_NODES=${MAX_AX_NODES}; original=${rawNodes.length}`);
      break;
    }
    const role = raw.role.value;
    const name = raw.name?.value;
    const attrs = extractKeyAttrs(raw);
    const hashMaterial = `${role}|${name ?? ''}|${JSON.stringify(attrs)}`;
    const attributeHash = await sha256Hex(hashMaterial);
    nodes.push({
      axNodeId: raw.nodeId,
      role,
      name,
      description: raw.description?.value,
      value: raw.value?.value != null ? String(raw.value.value) : undefined,
      attributes: Object.keys(attrs).length ? attrs : undefined,
      axPath: axPath(raw.nodeId),
      attributeHash,
    });
  }
  return nodes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd clients/browser-extension && pnpm test -- ax-snapshot`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add clients/browser-extension/src/canonical/ax-snapshot.ts clients/browser-extension/tests/ax-snapshot.test.ts
git commit -m "feat(extension): add collectAccessibilitySnapshot with AX tree flatten"
```

---

## Task 5: Wire AX Snapshot into captureObservation (Parallel Capture)

**Files:**
- Modify: `clients/browser-extension/src/canonical/observation.ts` (the `captureObservationInternal` function, ~line 856)
- Modify: `clients/browser-extension/tests/observation.test.ts` (add assertion)

- [ ] **Step 1: Read the relevant slice to confirm shape**

Open `clients/browser-extension/src/canonical/observation.ts` around line 856 (`captureObservationInternal`). The function builds `ObservationV1` at line ~971. The new field `accessibilityNodes` is added on the built object.

- [ ] **Step 2: Update the existing test**

In `clients/browser-extension/tests/observation.test.ts`, find the existing test that exercises `captureObservation` end-to-end. After it captures, add:

```typescript
  it('includes accessibilityNodes when sendCdpCommand returns AXTree', async () => {
    const obs = await captureObservation({
      tabId: 42,
      sendCdpCommand: async (_t, method) => {
        if (method === 'Accessibility.getFullAXTree') {
          return { nodes: [{ nodeId: '1', role: { value: 'button' }, name: { value: 'OK' } }] };
        }
        // fall through to existing mocks for DOM calls — copy from existing test
      },
      // ... copy remaining options from the surrounding test
    });
    expect(obs.accessibilityNodes).toBeDefined();
    expect(obs.accessibilityNodes!.length).toBeGreaterThan(0);
  });
```

Wire the `sendCdpCommand` mock to satisfy both the existing DOM mock surface and the new AX mock. Reuse the existing test's DOM mock as a base and branch on `method === 'Accessibility.getFullAXTree'`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd clients/browser-extension && pnpm test -- observation`
Expected: FAIL — `accessibilityNodes` undefined on result.

- [ ] **Step 4: Add parallel AX capture to observation.ts**

In `clients/browser-extension/src/canonical/observation.ts`:

1. Add import at top (after existing imports):

```typescript
import { collectAccessibilitySnapshot } from './ax-snapshot';
```

2. Inside `captureObservationInternal` (line ~856), right after the existing DOM capture variables are computed but before the final `ObservationV1` is built (~line 971), add:

```typescript
  const accessibilityNodes = await collectAccessibilitySnapshot(tabId, sendCdpCommand);
```

3. On the final object literal that constructs `observation` (~line 971), add field:

```typescript
    accessibilityNodes: accessibilityNodes.length > 0 ? accessibilityNodes : undefined,
```

Keep all existing fields untouched. Don't change DOM capture timing or order.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd clients/browser-extension && pnpm test -- observation`
Expected: PASS (existing tests + new test).

- [ ] **Step 6: Commit**

```bash
git add clients/browser-extension/src/canonical/observation.ts clients/browser-extension/tests/observation.test.ts
git commit -m "feat(extension): wire AX snapshot into captureObservation"
```

---

## Task 6: Integrate matchStableRef into verifyDeclaredTarget

**Files:**
- Modify: `clients/browser-extension/src/canonical/action-executor.ts` (the `verifyDeclaredTarget` function)
- Test: `clients/browser-extension/tests/canonical-action-executor.test.ts` (add a case if missing; otherwise create)

- [ ] **Step 1: Read verifyDeclaredTarget**

Open `clients/browser-extension/src/canonical/action-executor.ts`. Find `verifyDeclaredTarget` — confirm its current shape (takes `target`, `observation`, returns a verdict). It currently uses `coordinate-context.ts` for bounds checking.

- [ ] **Step 2: Add a failing test**

In `clients/browser-extension/tests/canonical-action-executor.test.ts`, append:

```typescript
import type { AccessibilityNode } from '@fara-platform/fara-action-schema';
import { StableRef } from '../src/canonical/stable-ref';

describe('verifyDeclaredTarget with StableRef', () => {
  it('accepts when StableRef.match returns confidence >= 0.8', async () => {
    const node: AccessibilityNode = {
      axNodeId: '1',
      role: 'button',
      name: 'Buy',
      axPath: [{ role: 'Document', index: 0 }, { role: 'button', index: 0, name: 'Buy' }],
      attributeHash: 'match',
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    };
    const target = { /* existing shape */ ref: StableRef.fromAXNode(node) } as any;
    const observation = { /* existing shape */ accessibilityNodes: [node] } as any;
    const result = await verifyDeclaredTarget(target, observation);
    expect(result.verified).toBe(true);
  });

  it('falls back to coordinates when StableRef.match misses', async () => {
    const target = { /* with mismatched ref OR no ref at all */ } as any;
    const observation = { /* accessibilityNodes: [] */ } as any;
    // existing coord-fallback path
    const result = await verifyDeclaredTarget(target, observation);
    // assertion depends on existing test surface — assert result shape unchanged
  });
});
```

Adapt `target` and `observation` shapes to match the existing `verifyDeclaredTarget` signature in `action-executor.ts`. Look at the surrounding existing tests for the exact shape.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd clients/browser-extension && pnpm test -- canonical-action-executor`
Expected: FAIL — current `verifyDeclaredTarget` ignores `target.ref`.

- [ ] **Step 4: Update verifyDeclaredTarget**

In `clients/browser-extension/src/canonical/action-executor.ts`:

1. Add imports at top:

```typescript
import { matchStableRef, MATCH_CONFIDENCE_THRESHOLD } from './ref-matcher';
import type { StableRef } from './stable-ref';
```

2. At the very top of `verifyDeclaredTarget`, before any coordinate work:

```typescript
  const ref = (target as { ref?: StableRef }).ref;
  const axNodes = (observation as { accessibilityNodes?: AccessibilityNode[] }).accessibilityNodes;
  if (ref && axNodes && axNodes.length > 0) {
    const match = matchStableRef(ref, axNodes);
    if (match.confidence >= MATCH_CONFIDENCE_THRESHOLD) {
      return { verified: true, strategy: `stable-ref:${match.strategy}` };
    }
  }
```

Use `as` casts only because `target.ref` is not yet in the action protocol (per spec open question 2). Remove when plan 2 adds `targetRef` to `AgentAction.target`.

3. Existing coordinate fallback path runs unchanged below the new block.

- [ ] **Step 5: Run tests to verify all pass**

Run: `cd clients/browser-extension && pnpm test`
Expected: PASS — full suite, no regressions.

- [ ] **Step 6: Commit**

```bash
git add clients/browser-extension/src/canonical/action-executor.ts clients/browser-extension/tests/canonical-action-executor.test.ts
git commit -m "feat(extension): verifyDeclaredTarget uses StableRef match first"
```

---

## Task 7: Add evals/contract Wire-Format Fixture

**Files:**
- Create: `evals/contract/ax-shape.test.ts`

- [ ] **Step 1: Read existing evals/contract structure**

Run: `ls evals/contract/` and read one existing test to match style (jest? tap? vitest?).

- [ ] **Step 2: Write the test**

Create `evals/contract/ax-shape.test.ts` (adapt imports/test-runner to match local convention):

```typescript
import { ObservationV1Schema, AccessibilityNodeSchema } from '@fara-platform/fara-action-schema';

const node = {
  axNodeId: '1',
  role: 'button',
  name: 'Submit',
  axPath: [{ role: 'Document', index: 0 }, { role: 'button', index: 0, name: 'Submit' }],
  attributeHash: 'a'.repeat(64),
  bounds: { x: 0, y: 0, width: 100, height: 30 },
};

describe('AX wire format', () => {
  it('AccessibilityNodeSchema parses canonical shape', () => {
    expect(() => AccessibilityNodeSchema.parse(node)).not.toThrow();
  });

  it('ObservationV1Schema accepts accessibilityNodes array', () => {
    const obs = {
      observationId: '00000000-0000-4000-8000-000000000001',
      capturedAt: '2026-08-06T00:00:00.000Z',
      page: { url: 'https://example.test', title: 't', viewport: { width: 1, height: 1, devicePixelRatio: 1 }, lifecycle: 'complete', visibility: 'visible' },
      screenshot: { kind: 'placeholder', bytes: '' },
      semanticTargets: [],
      accessibilityNodes: [node],
    };
    expect(() => ObservationV1Schema.parse(obs)).not.toThrow();
  });

  it('ObservationV1Schema without accessibilityNodes still valid', () => {
    const obs = {
      observationId: '00000000-0000-4000-8000-000000000002',
      capturedAt: '2026-08-06T00:00:00.000Z',
      page: { url: 'https://example.test', title: 't', viewport: { width: 1, height: 1, devicePixelRatio: 1 }, lifecycle: 'complete', visibility: 'visible' },
      screenshot: { kind: 'placeholder', bytes: '' },
      semanticTargets: [],
    };
    expect(() => ObservationV1Schema.parse(obs)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd evals/contract && pnpm test -- ax-shape` (or `npm test -- ax-shape` — match the dir's runner)
Expected: PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
git add evals/contract/ax-shape.test.ts
git commit -m "test(evals): add AX wire format contract"
```

---

## Self-Review Checklist

After completing all tasks:

1. **All existing tests pass:** `cd clients/browser-extension && pnpm test && cd ../../packages/fara-action-schema && pnpm test && cd ../../evals/contract && pnpm test`
2. **No `any` leakage in new code.** Casts in Task 6 use `as` for protocol gap; flagged in spec.
3. **Type consistency:** `StableRef`, `matchStableRef`, `collectAccessibilitySnapshot`, `AccessibilityNode`, `AXTuple` — same names and shapes across all tasks.
4. **Schema additive:** `accessibilityNodes` is `.optional()` — old observations still validate.
5. **No `cd` chains in commit commands.** Each commit happens from the right directory by the implementer's prior `cd`.

## Verification Checklist (from spec)

- [ ] `ObservationV1Schema` parses both old (no `accessibilityNodes`) and new shapes
- [ ] `StableRef.fromAXNode` produces identical hash for identical captures
- [ ] `matchStableRef` returns `fuzzy-bounds` for ±10px drift, `role-name` for renamed label
- [ ] Shadow DOM test fixture produces non-empty `accessibilityNodes` (manual: integration test deferred to plan 2)
- [ ] Existing canonical pipeline tests pass unchanged
- [ ] AX capture failure does not break observation (returns valid `ObservationV1` with empty `accessibilityNodes`)
