export function evaluateTerminationGate(input) {
    const missingMustHave = [];
    const missingShouldHave = [];
    for (const c of input.criteria) {
        const v = input.verifications[c.id];
        const isSatisfied = !!v && v.satisfied > 0;
        if (!isSatisfied) {
            if (c.kind === "must_have")
                missingMustHave.push(c.id);
            else
                missingShouldHave.push(c.id);
        }
    }
    if (missingMustHave.length === 0) {
        return {
            allowed: true,
            missingMustHave,
            missingShouldHave,
            reason: missingShouldHave.length === 0
                ? "all criteria verified"
                : `allowed with ${missingShouldHave.length} advisory criteria unverified`,
        };
    }
    return {
        allowed: false,
        missingMustHave,
        missingShouldHave,
        reason: `terminate blocked: ${missingMustHave.length} must_have criterion(s) unverified — ${missingMustHave.join(", ")}. Call verify_completion for each (or revisit the goal if extraction was wrong).`,
    };
}
//# sourceMappingURL=gate.js.map