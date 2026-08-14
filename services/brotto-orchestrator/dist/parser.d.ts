/**
 * Tool Call Parser and Validator
 *
 * Parses Brotto tool calls and validates arguments using brotto-action-schema
 * as specified in ARCHITECTURE.md section 3.2 and 3.5
 *
 * Per ARCHITECTURE.md section 3.2, the orchestrator must:
 * - Parse Brotto tool calls
 * - Validate all model arguments
 * - NOT let the model directly control dangerous actions
 */
import { type FaraAction } from '@brotto/brotto-action-schema';
import type { FaraToolCall } from './inference.js';
export type { FaraToolCall };
/**
 * Parsed and validated action with metadata
 */
export interface ParsedAction {
    action: FaraAction;
    validationWarnings: string[];
    rawToolCall: FaraToolCall;
}
/**
 * Parser result with all parsed actions
 */
export interface ParseResult {
    actions: ParsedAction[];
    errors: ParseError[];
}
/**
 * Parse error details
 */
export interface ParseError {
    toolCall: FaraToolCall;
    error: string;
    code: ParseErrorCode;
}
/**
 * Parse error codes
 */
export declare enum ParseErrorCode {
    UNKNOWN_TOOL = "UNKNOWN_TOOL",
    INVALID_ARGUMENTS = "INVALID_ARGUMENTS",
    BLOCKED_TOOL = "BLOCKED_TOOL",
    COORDINATES_OUT_OF_BOUNDS = "COORDINATES_OUT_OF_BOUNDS",
    INVALID_URL = "INVALID_URL",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    STALE_OBSERVATION = "STALE_OBSERVATION",
    STALE_TARGET = "STALE_TARGET"
}
/**
 * Coordinate bounds for validation
 */
export interface CoordinateBounds {
    width: number;
    height: number;
}
/**
 * Tool call parser and validator
 */
export declare class ToolCallParser {
    private coordinateBounds;
    private currentObservationId;
    private lastSemanticTargets;
    /**
     * Set viewport bounds for coordinate validation
     */
    setViewportBounds(bounds: CoordinateBounds): void;
    /**
     * Set current observation ID for staleness checking
     */
    setCurrentObservationId(id: number): void;
    setLastSemanticTargets(targets: ReadonlyArray<{
        targetId: string;
        stableRef?: string;
        boundingBox: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    }>): void;
    /**
     * Clear viewport bounds
     */
    clearBounds(): void;
    private resolveTargetId;
    private isRowContainer;
    /**
     * Parse and validate tool calls from Brotto inference
     *
     * Per ARCHITECTURE.md section 3.2:
     * - Parse Brotto tool calls
     * - Validate all model arguments
     * - Reject dangerous actions
     */
    parse(toolCalls: FaraToolCall[]): ParseResult;
    /**
     * Parse a single tool call
     */
    private parseSingle;
    /**
     * Build action arguments from tool call args
     */
    private buildActionArgs;
    /**
     * Get a string argument
     */
    private stringArg;
    /**
     * Get a number argument
     */
    private numberArg;
    /**
     * Validate coordinates are within bounds
     */
    private validateCoordinates;
    /**
     * Validate URL
     */
    private validateUrl;
    /**
     * Create Brotto action from validated args
     */
    private createFaraAction;
    /**
     * Generate a unique action ID
     */
    private generateActionId;
    /**
     * Check if a tool name is blocked
     */
    isBlockedTool(toolName: string): boolean;
    /**
     * Get list of available tool names
     */
    getAvailableTools(): string[];
}
/**
 * Create a default parser instance
 */
export declare function createToolCallParser(): ToolCallParser;
//# sourceMappingURL=parser.d.ts.map