import type { MemoryUpdate } from "../context/decision.js";
export type ScratchpadEntry = {
    kind: "memory";
    ts: number;
    update: MemoryUpdate;
} | {
    kind: "verify";
    ts: number;
    criterionId: string;
    satisfied: boolean;
    evidence: string;
};
export interface ScratchpadStore {
    append(sessionId: string, entry: ScratchpadEntry): Promise<void>;
    read(sessionId: string): Promise<ScratchpadEntry[]>;
}
export declare function createFileScratchpadStore(dataDir: string): ScratchpadStore;
//# sourceMappingURL=store.d.ts.map