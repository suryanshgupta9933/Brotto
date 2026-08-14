/**
 * Stagnation detection: track normalized action/observation signatures in a
 * rolling window. Repeated decisions are first a recovery signal sent to the
 * model (via system prompt feedback), then a bounded loop break.
 */
import type { StagnationSignal } from "./decision.js";
import type { ScratchpadEntry } from "../scratchpad/store.js";
export interface ActionSigInput {
    type?: string;
    url?: string;
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    fact?: string;
}
export interface ObservationSigInput {
    url?: string;
    title?: string;
    elements?: Array<{
        id?: string;
    }>;
}
export declare function actionSignature(action: ActionSigInput): string;
export declare function observationSignature(obs: ObservationSigInput): string;
export declare function detectStagnation(actionSigs: string[], obsSigs: string[]): StagnationSignal | null;
export declare function detectPlanningStagnation(entries: ScratchpadEntry[]): StagnationSignal | null;
//# sourceMappingURL=stagnation.d.ts.map