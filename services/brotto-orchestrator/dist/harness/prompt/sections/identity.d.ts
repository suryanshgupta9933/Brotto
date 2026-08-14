/**
 * System prompt sections — one file per concern. Pure functions returning
 * strings. The composer joins them.
 *
 * ponytail: keep each section self-contained. No shared state, no
 * cross-section imports. Each section is one exported function that takes
 * the opts it needs and returns the markdown for that section.
 */
export declare function identitySection(): string;
//# sourceMappingURL=identity.d.ts.map