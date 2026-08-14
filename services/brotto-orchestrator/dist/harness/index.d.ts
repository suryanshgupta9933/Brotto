/**
 * Public API for the modular agent harness.
 *
 * ponytail: this is the entry point. Consumers import from here:
 *
 *   import { createHarness, runHarness, PageSnapshotStore, composeSystemPrompt, ... } from "./harness";
 *
 * Each module is exported individually for fine-grained use; the top-level
 * helpers compose them.
 */
export * from "./types.js";
export { PageSnapshotStore, createPageSnapshotStore } from "./context/page-store.js";
export { Memory, createMemory } from "./context/memory.js";
export { Scratchpad, createScratchpad } from "./context/scratchpad.js";
export { History, createHistory } from "./context/history.js";
export { buildContext } from "./context/builder.js";
export { composeSystemPrompt } from "./prompt/composer.js";
export * as identitySection from "./prompt/sections/identity.js";
export * as loopContractSection from "./prompt/sections/loop-contract.js";
export * as pageSnapshotSection from "./prompt/sections/page-snapshot.js";
export * as memoryRulesSection from "./prompt/sections/memory-rules.js";
export * as searchRulesSection from "./prompt/sections/search-rules.js";
export * as domainRulesSection from "./prompt/sections/domain-rules.js";
export * as extractionRulesSection from "./prompt/sections/extraction-rules.js";
export * as stagnationRulesSection from "./prompt/sections/stagnation-rules.js";
export * as finalAnswerSection from "./prompt/sections/final-answer.js";
export { detectStagnation, detectSearchWorkflow, detectExtractionMissed, detectCookieDismissed, runActionDetectors, } from "./detectors/index.js";
export { canTerminate } from "./gates/termination.js";
export { answerCitesMemory } from "./gates/grounding.js";
export { correctiveMessages } from "./correction/templates.js";
export { buildNextGuidance, setNextGuidance } from "./correction/injector.js";
export { runHarness, createHarnessState } from "./loop.js";
export { createOpenAICompatibleAdapter } from "./planner/openai-compatible.js";
import type { HarnessOptions, HarnessResult } from "./types.js";
/**
 * High-level helper: run a single-agent loop with the given observation /
 * execution / planning callbacks. Returns the harness result.
 *
 * Example:
 *   const result = await runHarnessWithCallbacks({
 *     goal: "go to my gmail and check the status of my latest amazon package",
 *     maxSteps: 50,
 *     observe: async () => ({ url, title, headings, bodyText, ... }),
 *     execute: async (action) => executeAction(action),
 *     plan: async (prompt) => callLLM(prompt),
 *   });
 */
export declare function runHarnessWithCallbacks(opts: HarnessOptions): Promise<HarnessResult>;
//# sourceMappingURL=index.d.ts.map