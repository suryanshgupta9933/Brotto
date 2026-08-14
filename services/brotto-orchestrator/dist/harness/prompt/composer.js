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
import * as identity from "./sections/identity.js";
import * as loopContract from "./sections/loop-contract.js";
import * as pageSnapshot from "./sections/page-snapshot.js";
import * as memoryRules from "./sections/memory-rules.js";
import * as searchRules from "./sections/search-rules.js";
import * as explorationRules from "./sections/exploration-rules.js";
import * as domainRules from "./sections/domain-rules.js";
import * as extractionRules from "./sections/extraction-rules.js";
import * as stagnationRules from "./sections/stagnation-rules.js";
import * as finalAnswer from "./sections/final-answer.js";
export function composeSystemPrompt() {
    const sections = [
        identity.identitySection(),
        loopContract.loopContractSection(),
        pageSnapshot.pageSnapshotSection(),
        memoryRules.memoryRulesSection(),
        searchRules.searchRulesSection(),
        explorationRules.explorationRulesSection(),
        domainRules.domainRulesSection(),
        extractionRules.extractionRulesSection(),
        stagnationRules.stagnationRulesSection(),
        finalAnswer.finalAnswerSection(),
    ];
    return sections.join("\n\n");
}
//# sourceMappingURL=composer.js.map