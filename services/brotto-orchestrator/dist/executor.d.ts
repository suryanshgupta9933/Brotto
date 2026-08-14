/**
 * MCP Action Executor
 *
 * Executes approved actions through the Browser MCP Gateway as specified
 * in ARCHITECTURE.md section 3.2, 3.4, and 3.5
 *
 * Maps Brotto actions to Playwright MCP tools and coordinates execution
 */
import { type FaraAction, type ActionResult, type ObservationId, McpToolName } from '@brotto/brotto-action-schema';
/**
 * MCP tool call result
 */
export interface McpToolResult {
    success: boolean;
    result?: unknown;
    error?: string;
}
/**
 * MCP Gateway client interface
 */
export interface McpGatewayClient {
    /**
     * Call an MCP tool with parameters
     */
    callTool(toolName: McpToolName, params: Record<string, unknown>): Promise<McpToolResult>;
    /**
     * Check if gateway is connected
     */
    isConnected(): boolean;
    /**
     * Get gateway status
     */
    getStatus(): GatewayStatus;
}
/**
 * Gateway connection status
 */
export type GatewayStatus = {
    connected: true;
    sessionId: string;
} | {
    connected: false;
    reason?: string;
};
/**
 * Executor configuration
 */
export interface ExecutorConfig {
    mcpGateway: McpGatewayClient;
    sessionId: string;
    maxExecutionTimeMs?: number;
}
/**
 * MCP Action Executor
 *
 * Executes Brotto actions through the Browser MCP Gateway
 * Per ARCHITECTURE.md section 3.5, maps Brotto actions to Playwright MCP tools
 */
export declare class ActionExecutor {
    private mcpGateway;
    private maxExecutionTimeMs;
    private isExecuting;
    constructor(config: ExecutorConfig);
    /**
     * Execute a Brotto action
     *
     * Per ARCHITECTURE.md section 3.5, maps actions to MCP tools:
     * - left_click → browser_mouse_click_xy
     * - double_click → browser_mouse_click_xy (clickCount=2)
     * - right_click → browser_mouse_click_xy (button=right)
     * - drag → browser_mouse_drag_xy
     * - mouse_move → browser_mouse_move_xy
     * - scroll → browser_mouse_wheel
     * - key → browser_press_key
     * - visit_url → browser_navigate
     * - history_back → browser_navigate_back
     * - screenshot → browser_take_screenshot
     */
    execute(action: FaraAction, observationId: ObservationId): Promise<ActionResult>;
    /**
     * Execute an action via MCP tool
     */
    private executeMcpAction;
    /**
     * Execute wait action (handled by orchestrator timer)
     */
    private executeWait;
    /**
     * Execute with timeout
     */
    private executeWithTimeout;
    /**
     * Check if executor is currently executing
     */
    isBusy(): boolean;
    /**
     * Get gateway connection status
     */
    getGatewayStatus(): GatewayStatus;
    /**
     * Cancel current execution (if supported by gateway)
     */
    cancelExecution(): Promise<void>;
}
/**
 * Mock MCP Gateway client for testing
 */
export declare class MockMcpGatewayClient implements McpGatewayClient {
    private connected;
    private sessionId;
    private mockResults;
    constructor(connected?: boolean, sessionId?: string);
    setConnected(connected: boolean, sessionId?: string): void;
    setMockResult(toolName: McpToolName, result: McpToolResult): void;
    callTool(toolName: McpToolName, params: Record<string, unknown>): Promise<McpToolResult>;
    isConnected(): boolean;
    getStatus(): GatewayStatus;
}
/**
 * Create an action executor with configuration
 */
export declare function createActionExecutor(config: ExecutorConfig): ActionExecutor;
//# sourceMappingURL=executor.d.ts.map