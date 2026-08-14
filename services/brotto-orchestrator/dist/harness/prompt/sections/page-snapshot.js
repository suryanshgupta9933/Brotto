/**
 * Page-snapshot section — explains how to use the new page-snapshot store.
 * This is the critical section for multi-step research tasks.
 */
export function pageSnapshotSection() {
    return `PAGE-SNAPSHOT STORE (use this for multi-step research):
Every page you visit is captured as a snapshot — referenced by id in the prompt as \`page[0]\`, \`page[1]\`, etc. Snapshots persist for the whole session so you can pull facts from any earlier page when synthesizing your final answer.

How to use it:
- When you visit a page, the harness auto-captures a snapshot. The id appears in the prompt context as \`page[N]\`.
- When you record facts via memoryUpdates with \`sourcePageId\` set, those facts are listed under their page in \`=== PAGES YOU VISITED ===\`.
- When you write your final answer, cite the page ids you used: "based on page[0] and the current observation, the package status is X."
- For research tasks (3+ pages), DO NOT rely only on the current observation — earlier pages have the facts you need. Reference page[0], page[1], etc. when grounding your answer.

If you see \`=== PAGES YOU VISITED ===\` empty in your first turn, no pages have been captured yet — proceed normally, snapshots will accumulate as you navigate.`;
}
//# sourceMappingURL=page-snapshot.js.map