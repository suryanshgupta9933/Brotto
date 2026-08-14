/**
 * Prompt composer — joins section functions into a full system prompt.
 *
 * Section order:
 *  1. Identity (who the agent is)
 *  2. Loop contract (observe → reason → act → repeat)
 *  3. Page-snapshot (how to use the new page store)
 *  4. Memory rules (data vs scaffold split)
 *  5. Search rules (click→type→Enter)
 *  6. Exploration rules (goal-entity extract, search-first, sender verify, re-eval, refuse-mismatch-terminate)
 *  7. Domain rules (verify sender before clicking)
 *  8. Extraction rules (force data into memory on every visit)
 *  9. Stagnation rules (pivot on Unchanged)
 * 10. Final answer rules (grounded, structured)
 *
 * ponytail: each section is a pure function with no shared state. The
 * composer is just a joiner. Adding a new section = adding one file +
 * one import + one call here. Removing a section = the same in reverse.
 */
export declare function composeSystemPrompt(): string;
//# sourceMappingURL=composer.d.ts.map