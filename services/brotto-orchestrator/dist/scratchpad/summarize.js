export function summarize(entries) {
    const phase_outline = [];
    const phases_done = [];
    const next_step = [];
    const partial = [];
    const facts = [];
    // ponytail: dedupe by key, last-writer-wins.
    const byKey = new Map();
    const verifications = {};
    for (const e of entries) {
        if (e.kind === "verify") {
            const v = verifications[e.criterionId] ?? { satisfied: 0, unsatisfied: 0 };
            if (e.satisfied) {
                v.satisfied += 1;
                v.latestEvidence = e.evidence;
            }
            else {
                v.unsatisfied += 1;
            }
            verifications[e.criterionId] = v;
            continue;
        }
        const u = e.update;
        if (!u || !u.key)
            continue;
        if (u.key === "phase_outline" || u.key.startsWith("phase_outline_")) {
            phase_outline.push(u);
        }
        else if (u.key === "next_step") {
            next_step.push(u);
        }
        else if (/^phase_\d+_done$/.test(u.key)) {
            phases_done.push(u);
        }
        else if (u.key.startsWith("partial_")) {
            partial.push(u);
        }
        else {
            facts.push(u);
        }
        byKey.set(u.key, u);
    }
    return {
        phase_outline,
        phases_done,
        next_step,
        partial,
        facts,
        verifications,
        totalEntries: entries.length,
    };
}
//# sourceMappingURL=summarize.js.map