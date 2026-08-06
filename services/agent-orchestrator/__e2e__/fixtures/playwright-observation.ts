import type { Page } from "playwright";
import type { ObservationV1, SemanticTarget, AccessibilityNode } from "@fara-platform/fara-action-schema";

const VALID_HASH = "a".repeat(64);

function uuid(): string {
  return crypto.randomUUID();
}

async function extractSemanticTargets(page: Page): Promise<SemanticTarget[]> {
  return page.evaluate(() => {
    const interactives = Array.from(document.querySelectorAll("input, button, a, select, textarea, [role=button], [role=link]"));
    return interactives.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const accessibleName =
        el.getAttribute("aria-label") ??
        (el.textContent ?? "").trim().slice(0, 200) ??
        (el as HTMLInputElement).value ??
        "";
      const target: SemanticTarget = {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
        accessibleName: { source: "visible_text" as const, text: accessibleName },
        label: accessibleName,
        attributes: Object.fromEntries(
          Array.from(el.attributes).map((a) => [a.name, a.value]),
        ),
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: rect.width > 0 && rect.height > 0,
        framePath: [],
        locatorCandidates: [],
        targetId: `t${i}` as never,
      };
      return target;
    });
  });
}

interface FlatAxNode {
  role: string;
  name?: string;
  axNodeId: string;
  axPath: Array<{ role: string; index: number; name?: string }>;
}

async function extractAxSnapshot(page: Page): Promise<FlatAxNode[]> {
  // ponytail: Playwright's page.accessibility.snapshot isn't available across all
  // versions; fall back to a DOM-derived AX list (each interactive element as a
  // node) when the native API is missing. Less rich than the browser AX tree,
  // but enough for the demo.
  let snapshot: { role?: string; name?: string; children?: unknown[] } | null = null;
  try {
    if (typeof (page as unknown as { accessibility?: { snapshot?: unknown } }).accessibility?.snapshot === "function") {
      snapshot = await (page as unknown as { accessibility: { snapshot: (opts: { interestingOnly: boolean }) => Promise<typeof snapshot> } }).accessibility.snapshot({ interestingOnly: true });
    }
  } catch {
    snapshot = null;
  }
  if (!snapshot) {
    return await page.evaluate(() => {
      const interactives = Array.from(document.querySelectorAll("input, button, a, select, textarea, [role=button], [role=link], h1, h2, h3, label"));
      return interactives.slice(0, 100).map((el, i) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent ?? "").trim().slice(0, 100);
        return {
          role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
          name: text || undefined,
          axNodeId: `dom-${i}`,
          axPath: [{ role: el.tagName.toLowerCase(), index: i, name: text || undefined }],
        };
      });
    });
  }

  const flat: FlatAxNode[] = [];
  let idx = 0;
  const walk = (
    node: { role?: string; name?: string; children?: unknown[] },
    path: Array<{ role: string; index: number; name?: string }>,
  ) => {
    const role = node.role ?? "generic";
    const childIndex = path.length === 0 ? idx : path[path.length - 1].index;
    const tuple = { role, index: childIndex, name: node.name };
    flat.push({
      role,
      name: node.name,
      axNodeId: `${path.length}-${idx++}`,
      axPath: [...path, tuple],
    });
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child as { role?: string; name?: string; children?: unknown[] }, [...path, tuple]);
      }
    }
  };
  walk(snapshot, []);
  return flat;
}

export async function captureObservation(page: Page): Promise<ObservationV1> {
  const url = page.url();
  const title = await page.title();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const semanticTargets = await extractSemanticTargets(page);
  const flatAx = await extractAxSnapshot(page);
  const accessibilityNodes: AccessibilityNode[] = flatAx.map((n) => ({
    axNodeId: n.axNodeId,
    role: n.role,
    name: n.name,
    axPath: n.axPath,
    attributeHash: VALID_HASH,
  }));
  return {
    observationId: uuid() as never,
    capturedAt: new Date().toISOString(),
    url,
    title,
    page: {
      tabId: uuid() as never,
      frameId: uuid() as never,
      lifecycle: "complete",
      visibility: "visible",
    },
    viewport: { ...viewport, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
    screenshot: { kind: "inline", encoding: "base64", data: "a", sha256: VALID_HASH, width: 1, height: 1 },
    semanticTargets,
    accessibilityNodes,
  };
}
