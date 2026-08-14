// Re-export everything as any for now - full schema will be added later
export type ActionTypeV1 = string;
export type ActionCommandV1 = Record<string, any>;
export type ExecutableActionV1 = Record<string, any>;
export type ActionResultV1 = Record<string, any>;
export type ObservationV1 = Record<string, any>;
export type SemanticTarget = Record<string, any>;
export type AccessibilityNode = Record<string, any>;
export type AXTuple = any[];
export type ForbiddenBrowserDataError = Error;
export type LocatorCandidateV1 = Record<string, any>;
export type SanitizedAccessibleName = string;

export const ActionCommandV1Schema = {};
export const ActionResultV1Schema = {};
export const ObservationV1Schema = {};
export const SemanticTargetSchema = {};

export function assertNoForbiddenBrowserData(data: any): void {}
