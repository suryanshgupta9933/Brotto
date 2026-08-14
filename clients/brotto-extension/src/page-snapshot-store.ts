/**
 * PageSnapshotStore for the extension driver — self-contained.
 *
 * ponytail: this used to import from the harness source but tsx/bundler
 * resolution broke across workspaces. Self-contained version, mirrors
 * the harness API contract so renderObservationForPlanner can use the
 * same `formatForPrompt` shape. The canonical reference is
 * services/brotto-orchestrator/src/harness/context/page-store.ts —
 * keep this in sync.
 */

export interface PageSnapshot {
  id: number;
  url: string;
  heading: string;
  headings: string[];
  bodyText: string;
  interactiveElementLabels: string[];
  visitedAt: number;
  goalRelevant: boolean;
}

const MAX_HEADINGS = 5;
const MAX_BODY_CHARS = 2000;
const MAX_ELEMENT_LABELS = 20;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export interface PageSnapshotStoreAPI {
  capture(obs: { url: string; title: string; headings: string[]; bodyText: string; interactiveElementLabels: string[] }): number;
  size(): number;
  formatForPrompt(maxChars: number, memoryByPage: Map<number, string[]>): string;
}

export function createPageSnapshotStore(): PageSnapshotStoreAPI {
  const pages: PageSnapshot[] = [];
  let nextId = 0;

  return {
    capture(obs) {
      const id = nextId++;
      pages.push({
        id,
        url: obs.url,
        heading: obs.headings[0] ?? "(no heading)",
        headings: obs.headings.slice(0, MAX_HEADINGS),
        bodyText: truncate(obs.bodyText, MAX_BODY_CHARS),
        interactiveElementLabels: obs.interactiveElementLabels.slice(0, MAX_ELEMENT_LABELS),
        visitedAt: Date.now(),
        goalRelevant: obs.headings.length > 0,
      });
      return id;
    },
    size() {
      return pages.length;
    },
    formatForPrompt(maxChars, memoryByPage) {
      if (pages.length === 0) return "";
      const lines: string[] = ["=== PAGES YOU VISITED (refer by id, e.g. \"page[0]\") ==="];
      for (const p of pages) {
        lines.push(`[page[${p.id}]] ${p.heading}`);
        lines.push(`  URL: ${p.url}`);
        lines.push(`  Goal-relevant: ${p.goalRelevant ? "yes" : "no"}`);
        const facts = memoryByPage.get(p.id) ?? [];
        if (facts.length > 0) {
          lines.push(`  Recorded facts: ${facts.join(", ")}`);
        }
        lines.push("");
      }
      let out = lines.join("\n");
      if (out.length > maxChars) {
        out = out.slice(0, maxChars - 3) + "…";
      }
      return out;
    },
  };
}