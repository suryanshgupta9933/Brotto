// Type definitions for Brotto action schema
export type ActionTypeV1 = string;
export type ActionCommandV1 = Record<string, any>;
export type ExecutableActionV1 = Record<string, any>;
export type ActionResultV1 = Record<string, any>;
export type ObservationV1 = Record<string, any>;
export type SemanticTarget = Record<string, any>;
export type AccessibilityNode = Record<string, any>;
export type AXTuple = any[];
export type LocatorCandidateV1 = Record<string, any>;
export type SanitizedAccessibleName = string;
export type ApprovalResolutionV1 = Record<string, any>;

// Custom error class
export class ForbiddenBrowserDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenBrowserDataError';
  }
}

// Schema definitions
export const ActionCommandV1Schema = { parse: (data: any) => data };
export const ActionResultV1Schema = { parse: (data: any) => data };
export const ObservationV1Schema = { parse: (data: any) => data, safeParse: (data: any) => ({ success: true, data }) };
export const SemanticTargetSchema = { parse: (data: any) => data };

// Validation function
export function assertNoForbiddenBrowserData(data: any): void {
  // Validation placeholder
  if (!data) return;
}
