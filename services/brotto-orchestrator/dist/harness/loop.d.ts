/**
 * Main loop — orchestrates observation → plan → detect → execute → record.
 *
 * ponytail: this is the only file with state mutations. Every other module
 * is a pure function. The loop reads state, calls pure functions, applies
 * their results, and updates state. Easy to read, easy to debug.
 */
import type { HarnessOptions, HarnessState, HarnessResult } from "./types.js";
export declare function createHarnessState(opts: HarnessOptions): HarnessState;
export declare function runHarness(opts: HarnessOptions): Promise<HarnessResult>;
//# sourceMappingURL=loop.d.ts.map