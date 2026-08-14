/**
 * Main loop — orchestrates observation → plan → detect → execute → record.
 *
 * ponytail: this is the only file with state mutations. Every other module
 * is a pure function. The loop reads state, calls pure functions, applies
 * their results, and updates state. Easy to read, easy to debug.
 */
import { createPageSnapshotStore } from "./context/page-store.js";
import { createMemory } from "./context/memory.js";
import { createScratchpad } from "./context/scratchpad.js";
import { createHistory } from "./context/history.js";
import { buildContext } from "./context/builder.js";
import { composeSystemPrompt } from "./prompt/composer.js";
import { runActionDetectors } from "./detectors/index.js";
import { canTerminate } from "./gates/termination.js";
import { buildNextGuidance } from "./correction/injector.js";
import { correctiveMessages } from "./correction/templates.js";
import { extractCriteria } from "../criteria/extract.js";
export function createHarnessState(opts) {
    const goalKeywords = extractGoalKeywords(opts.goal);
    const criteria = extractCriteria(opts.goal).criteria;
    const expectedMemoryKeys = extractExpectedMemoryKeys(opts.goal);
    return {
        goal: opts.goal,
        goalKeywords,
        steps: 0,
        maxSteps: opts.maxSteps,
        pageStore: createPageSnapshotStore(),
        memory: createMemory(),
        scratchpad: createScratchpad(),
        history: createHistory(),
        actionSignatures: [],
        sigRepeatCounts: new Map(),
        currentSnapshotId: 0,
        nextGuidance: "",
        recentDetectorResults: [],
        criteria,
        verifications: new Map(),
        expectedMemoryKeys,
        recordedMemoryKeys: new Set(),
        terminated: false,
        terminateBlocked: false,
    };
}
function extractGoalKeywords(goal) {
    const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "have", "are", "was", "were", "but", "not", "you", "all", "any", "can", "had", "her", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use"]);
    const words = goal.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [];
    return [...new Set(words.filter((w) => !stop.has(w)))];
}
function extractExpectedMemoryKeys(goal) {
    const out = [];
    const seen = new Set();
    for (const m of goal.matchAll(/\b([a-z][a-z0-9_]*)_\d+\b/g)) {
        if (seen.has(m[0]))
            continue;
        seen.add(m[0]);
        out.push(m[0]);
    }
    for (const m of goal.matchAll(/\bkey\b[\s'"=`]*([a-z][a-z0-9_]+)/gi)) {
        if (seen.has(m[1]))
            continue;
        seen.add(m[1]);
        out.push(m[1]);
    }
    return out;
}
function deriveFinalAnswer(action, _state) {
    const explicit = (typeof action.finalAnswer === "string" && action.finalAnswer.trim()) || "";
    if (explicit)
        return explicit.trim();
    // Fallback: derive from reasoning's DECISION: line
    const reasoning = action.reasoning ?? "";
    const decisionMatch = reasoning.match(/DECISION:\s*([\s\S]+?)$/i);
    if (decisionMatch && decisionMatch[1].trim().length >= 40) {
        return decisionMatch[1].trim();
    }
    return "(no answer)";
}
export async function runHarness(opts) {
    const state = createHarnessState(opts);
    const systemPrompt = composeSystemPrompt();
    const allDetectorResults = [];
    let terminated = false;
    let finalAnswer;
    while (state.steps < state.maxSteps && !terminated) {
        if (opts.signal?.aborted)
            break;
        // 1. Capture observation
        let observation;
        try {
            observation = await opts.observe();
        }
        catch (e) {
            console.error(`[harness] observation failed at step ${state.steps + 1}:`, e);
            state.steps += 1;
            continue;
        }
        // 2. Capture page snapshot (the new feature)
        const pageSnapshotId = state.pageStore.capture(observation, state.goalKeywords);
        state.currentSnapshotId = pageSnapshotId;
        // 3. Build prompt context
        const contextText = buildContext({ state, observation, pageStore: state.pageStore });
        // 4. Call LLM
        let action;
        try {
            action = await opts.plan(`${systemPrompt}\n\n${contextText}`);
        }
        catch (e) {
            console.error(`[harness] plan failed at step ${state.steps + 1}:`, e);
            state.steps += 1;
            continue;
        }
        // 5. Apply model state mutations
        for (const u of action.memoryUpdates ?? []) {
            state.memory.set(u.key, u.value, u.evidence, pageSnapshotId);
            state.recordedMemoryKeys.add(u.key);
        }
        for (const u of action.scratchpadUpdates ?? []) {
            state.scratchpad.set(u.key, u.value);
        }
        if (action.verifyCompletion) {
            const v = action.verifyCompletion;
            const cur = state.verifications.get(v.criterionId) ?? { satisfied: 0, unsatisfied: 0 };
            if (v.satisfied) {
                cur.satisfied += 1;
                cur.latestEvidence = v.evidence;
            }
            else {
                cur.unsatisfied += 1;
            }
            state.verifications.set(v.criterionId, cur);
        }
        state.history.push({
            index: state.steps + 1,
            type: action.type,
            args: action.args,
            result: "(executed)", // filled in after execution
            url: observation.url,
            pageSnapshotId,
            at: Date.now(),
        });
        // 6. Run detectors on the action
        const detectorResults = runActionDetectors(state, action, pageSnapshotId);
        allDetectorResults.push(...detectorResults);
        // 7. Compute next-prompt guidance (correctives + terminate-blocked)
        let nextGuidance = buildNextGuidance(state, detectorResults);
        // 8. Handle terminate
        if (action.type === "terminate") {
            const candidateAnswer = deriveFinalAnswer(action, state);
            state.finalAnswer = candidateAnswer;
            const gateResult = canTerminate(state);
            if (!gateResult.allowed) {
                state.terminateBlocked = true;
                nextGuidance = `${correctiveMessages.terminateBlocked(gateResult.reasons)}\n\n${nextGuidance}`;
                state.nextGuidance = nextGuidance;
                state.steps += 1;
                continue;
            }
            terminated = true;
            finalAnswer = candidateAnswer;
            state.terminated = true;
            break;
        }
        state.nextGuidance = nextGuidance;
        state.steps += 1;
        // 9. Execute the action
        let result;
        try {
            result = await opts.execute(action);
        }
        catch (e) {
            result = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
        // Update history with execution result
        const lastHistory = state.history.list().at(-1);
        if (lastHistory)
            lastHistory.result = result;
    }
    return {
        steps: state.steps,
        finalAnswer,
        terminated: state.terminated,
        history: state.history.list(),
        pages: state.pageStore.list(),
        memory: state.memory.list(),
        scratchpad: state.scratchpad.list(),
        detectorResults: allDetectorResults,
    };
}
//# sourceMappingURL=loop.js.map