/**
 * PageSnapshotStore — every page the agent visits is captured here. Model
 * references pages by id (page[0], page[1], ...) when synthesizing final
 * answers or recalling earlier context.
 *
 * ponytail: the harness MUST be able to surface all visited pages to the
 * model so a multi-step research task can pull facts from page[0] when
 * constructing the final answer at page[N]. The previous design threw away
 * all earlier pages — the model only ever saw the current observation.
 *
 * Snapshots are derived from PageObservation (no separate capture). The
 * store picks which fields to keep and assigns sequential ids.
 */
import type { PageObservation, PageSnapshot, PageStoreAPI } from "../types.js";
export declare class PageSnapshotStore implements PageStoreAPI {
    private nextId;
    private pages;
    capture(observation: PageObservation, goalKeywords?: string[]): number;
    get(id: number): PageSnapshot | undefined;
    list(): PageSnapshot[];
    size(): number;
    /**
     * Render for the prompt. Format:
     *   === PAGES YOU VISITED (refer by id, e.g. "page[0]") ===
     *   [page[0]] Inbox - Gmail
     *     URL: https://mail.google.com/mail/u/0/
     *     Goal-relevant: yes
     *     Recorded facts: <memory recorded on this page>
     *   ...
     *
     * When factsRecordedByPage is provided, the per-page section includes
     * which memory keys the model recorded on that page (via sourcePageId).
     */
    formatForPrompt(maxChars: number, factsRecordedByPage?: Map<number, string[]>): string;
}
export declare function createPageSnapshotStore(): PageSnapshotStore;
//# sourceMappingURL=page-store.d.ts.map