/**
 * Shared types for the modular agent harness.
 *
 * ponytail: keep this dumb. These are interfaces, no business logic. Each
 * module (page-store, memory, detectors, gates) implements a subset. The
 * loop wires them together via HarnessState.
 */
export interface PageObservation {
    url: string;
    /** Optional page title — not used in the rendered prompt (plan: drop the title from chat). */
    title?: string;
    /** Path component of the URL — surfaced in prompt for orientation. */
    path?: string;
    /** First 5 h1/h2/h3 headings on the page. */
    headings: string[];
    /** Up to 2000 chars of meaningful body text (deduped, chrome filtered). */
    bodyText: string;
    /** Labels of up to 20 interactive elements (id-tag-label). */
    interactiveElementLabels: string[];
    /** Snapshot id assigned by the page store at capture time. */
    snapshotId: number;
    /** When the observation was captured. */
    capturedAt: number;
}
export interface PageSnapshot {
    id: number;
    url: string;
    /** Page heading (first h1) — purely for display in the prompt, not the browser title. */
    heading: string;
    /** Top 5 h1/h2 headings. */
    headings: string[];
    /** First 2000 chars of meaningful body text. */
    bodyText: string;
    /** Top 20 interactive element labels. */
    interactiveElementLabels: string[];
    visitedAt: number;
    /** Whether this page had content matching goal keywords — used to flag useful pages. */
    goalRelevant: boolean;
}
export interface MemoryFact {
    key: string;
    value: string;
    evidence?: string;
    /** When the fact was recorded. */
    recordedAt: number;
    /** The page snapshot id this fact was extracted from. */
    sourcePageId: number | null;
}
export interface ScratchpadEntry {
    key: string;
    value: string;
    recordedAt: number;
}
export interface HistoryEntry {
    index: number;
    /** Action type (left_click, insert_text, visit_url, etc.). */
    type: string;
    /** Action args (truncated for prompt size). */
    args: Record<string, unknown>;
    /** Result string from the executor ([Unchanged], [REJECTED], clicked text, etc.). */
    result: string;
    url: string;
    /** Page snapshot id of the page this action targeted. */
    pageSnapshotId: number;
    at: number;
}
export type DetectorSeverity = "info" | "warn" | "block";
export interface DetectResult {
    detector: string;
    severity: DetectorSeverity;
    /** Corrective message to inject into the next prompt. null = no issue. */
    message: string | null;
}
export interface GateResult {
    allowed: boolean;
    reasons: string[];
}
export interface HarnessState {
    goal: string;
    goalKeywords: string[];
    steps: number;
    maxSteps: number;
    pageStore: PageStoreAPI;
    memory: MemoryAPI;
    scratchpad: ScratchpadAPI;
    history: HistoryAPI;
    actionSignatures: string[];
    /** Per-signature repeat counter for stagnation escape (Fix 5). */
    sigRepeatCounts: Map<string, number>;
    /** Tracks the most recent page snapshot id (used to anchor current observation). */
    currentSnapshotId: number;
    /** The corrective guidance to inject on the NEXT turn. */
    nextGuidance: string;
    /** Detectors that fired this turn — passed to the next prompt. */
    recentDetectorResults: DetectResult[];
    /** Criteria extracted from the goal (must-have + should-have). */
    criteria: {
        id: string;
        description: string;
        kind: "must_have" | "should_have";
    }[];
    /** Verifications recorded by the model. */
    verifications: Map<string, {
        satisfied: number;
        unsatisfied: number;
        latestEvidence?: string;
    }>;
    /** Memory keys the goal expects (extracted from `key=X` patterns). */
    expectedMemoryKeys: string[];
    /** Set of memory keys already recorded. */
    recordedMemoryKeys: Set<string>;
    /** Has terminate fired (and succeeded)? */
    terminated: boolean;
    /** Last terminate attempt was blocked. */
    terminateBlocked: boolean;
    /** Last finalAnswer (post-grounding fallback). */
    finalAnswer?: string;
}
export interface PageStoreAPI {
    capture(observation: PageObservation): number;
    get(id: number): PageSnapshot | undefined;
    list(): PageSnapshot[];
    formatForPrompt(maxChars: number): string;
}
export interface MemoryAPI {
    set(key: string, value: string, evidence?: string, sourcePageId?: number): void;
    get(key: string): MemoryFact | undefined;
    list(): MemoryFact[];
    has(key: string): boolean;
    size(): number;
    formatForPrompt(maxChars: number): string;
    factsBySourcePage(): Map<number, string[]>;
}
export interface ScratchpadAPI {
    set(key: string, value: string): void;
    get(key: string): string | undefined;
    list(): ScratchpadEntry[];
    size(): number;
    formatForPrompt(maxChars: number): string;
}
export interface HistoryAPI {
    push(entry: HistoryEntry): void;
    recent(n: number): HistoryEntry[];
    list(): HistoryEntry[];
    formatForPrompt(maxChars: number): string;
}
export interface ParsedAction {
    type: string;
    /** Tool-specific args (targetId, url, text, etc.). */
    args: Record<string, unknown>;
    /** Model's structured reasoning (the GOAL/PROGRESS/NEXT/DECISION scratchpad). */
    reasoning: string;
    /** Model's user-facing one-liner (the bubble title). */
    clientText?: string;
    /** Memory updates the model wants to record. */
    memoryUpdates?: Array<{
        key: string;
        value: string;
        evidence?: string;
    }>;
    /** Scratchpad updates. */
    scratchpadUpdates?: Array<{
        key: string;
        value: string;
    }>;
    /** Verify-completion payload (when type === 'verify_completion'). */
    verifyCompletion?: {
        criterionId: string;
        satisfied: boolean;
        evidence?: string;
    };
    /** Final answer (when type === 'terminate'). */
    finalAnswer?: string;
}
export interface HarnessOptions {
    goal: string;
    maxSteps: number;
    /** Capture the next observation. */
    observe: () => Promise<PageObservation>;
    /** Execute an action and return the result string. */
    execute: (action: ParsedAction) => Promise<string>;
    /** Plan the next action given the prompt context. */
    plan: (prompt: string) => Promise<ParsedAction>;
    /** Optional abort signal. */
    signal?: AbortSignal;
}
export interface HarnessResult {
    steps: number;
    finalAnswer?: string;
    terminated: boolean;
    history: HistoryEntry[];
    pages: PageSnapshot[];
    memory: MemoryFact[];
    scratchpad: ScratchpadEntry[];
    detectorResults: DetectResult[];
}
//# sourceMappingURL=types.d.ts.map