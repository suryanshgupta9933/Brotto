/**
 * MCP Action Executor
 *
 * Executes approved actions through the Browser MCP Gateway as specified
 * in ARCHITECTURE.md section 3.2, 3.4, and 3.5
 *
 * Maps Fara actions to Playwright MCP tools and coordinates execution
 */

import {
  ActionType,
  type FaraAction,
  type ActionResult,
  type ObservationId,
  McpToolName,
  mapActionToMcpParams,
  getMcpToolName,
  getActionExecutionType,
  ActionExecutionType,
  ActionErrorCode,
  type ActionSuccessData,
  createActionSuccess,
  createActionFailure,
} from '@fara-platform/fara-action-schema';

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
export type GatewayStatus =
  | { connected: true; sessionId: string }
  | { connected: false; reason?: string };

/**
 * Executor configuration
 */
export interface ExecutorConfig {
  mcpGateway: McpGatewayClient;
  sessionId: string;
  maxExecutionTimeMs?: number;
}

/**
 * Default execution timeout
 */
const DEFAULT_EXECUTION_TIMEOUT = 30000; // 30 seconds

/**
 * MCP Action Executor
 *
 * Executes Fara actions through the Browser MCP Gateway
 * Per ARCHITECTURE.md section 3.5, maps Fara actions to Playwright MCP tools
 */
export class ActionExecutor {
  private mcpGateway: McpGatewayClient;
  private maxExecutionTimeMs: number;
  private isExecuting = false;

  constructor(config: ExecutorConfig) {
    this.mcpGateway = config.mcpGateway;
    this.maxExecutionTimeMs = config.maxExecutionTimeMs ?? DEFAULT_EXECUTION_TIMEOUT;
  }

  /**
   * Execute a Fara action
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
  async execute(action: FaraAction, observationId: ObservationId): Promise<ActionResult> {
    if (this.isExecuting) {
      return createActionFailure(
        action.type,
        ActionErrorCode.UNKNOWN,
        'Executor busy with another action'
      );
    }

    if (!this.mcpGateway.isConnected()) {
      return createActionFailure(
        action.type,
        ActionErrorCode.UNKNOWN,
        'MCP Gateway not connected'
      );
    }

    this.isExecuting = true;
    const startTime = Date.now();

    try {
      // Handle non-MCP actions
      const executionType = getActionExecutionType(action.type);

      switch (executionType) {
        case ActionExecutionType.ORCHESTRATOR_TIMER:
          return this.executeWait(action);

        case ActionExecutionType.CONTROL_PLANE_APPROVAL:
          return createActionFailure(
            action.type,
            ActionErrorCode.PERMISSION_DENIED,
            'ask_user_question requires control plane approval - should not reach executor'
          );

        case ActionExecutionType.SESSION_COMPLETION:
          return createActionSuccess(action.type);

        case ActionExecutionType.SESSION_MEMORY:
          return createActionSuccess(action.type);

        case ActionExecutionType.MCP_TOOL:
        default:
          return this.executeMcpAction(action, observationId, startTime);
      }
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute an action via MCP tool
   */
  private async executeMcpAction(
    action: FaraAction,
    _observationId: ObservationId,
    startTime: number
  ): Promise<ActionResult> {
    const toolName = getMcpToolName(action.type);

    if (!toolName) {
      return createActionFailure(
        action.type,
        ActionErrorCode.NOT_SUPPORTED,
        `No MCP tool mapping for action type: ${action.type}`
      );
    }

    const params = mapActionToMcpParams(action);
    if (!params) {
      return createActionFailure(
        action.type,
        ActionErrorCode.UNKNOWN,
        `Failed to map action to MCP parameters: ${action.type}`
      );
    }

    // Execute with timeout
    const result = await this.executeWithTimeout(
      this.mcpGateway.callTool(toolName, params as Record<string, unknown>),
      this.maxExecutionTimeMs
    );

    const duration = Date.now() - startTime;

    if (result.success) {
      const data = result.result !== null && typeof result.result === 'object'
        ? result.result as ActionSuccessData
        : undefined;
      return createActionSuccess(action.type, data);
    } else {
      return createActionFailure(
        action.type,
        ActionErrorCode.UNKNOWN,
        result.error || 'Unknown MCP error',
        { durationMs: duration }
      );
    }
  }

  /**
   * Execute wait action (handled by orchestrator timer)
   */
  private executeWait(action: FaraAction): Promise<ActionResult> {
    if (action.type !== ActionType.WAIT) {
      return Promise.resolve(
        createActionFailure(action.type, ActionErrorCode.NOT_SUPPORTED, 'Not a wait action')
      );
    }

    return new Promise((resolve) => {
      setTimeout(
        () => {
          resolve(
            createActionSuccess(action.type)
          );
        },
        Math.min(action.duration, this.maxExecutionTimeMs) // Cap at max execution time
      );
    });
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle!);
    }
  }

  /**
   * Check if executor is currently executing
   */
  isBusy(): boolean {
    return this.isExecuting;
  }

  /**
   * Get gateway connection status
   */
  getGatewayStatus(): GatewayStatus {
    return this.mcpGateway.getStatus();
  }

  /**
   * Cancel current execution (if supported by gateway)
   */
  async cancelExecution(): Promise<void> {
    // Note: This would require support from the MCP gateway
    // For now, we just set a flag that the executor checks
    this.isExecuting = false;
  }
}

/**
 * Mock MCP Gateway client for testing
 */
export class MockMcpGatewayClient implements McpGatewayClient {
  private connected = false;
  private sessionId: string | null = null;
  private mockResults: Map<string, McpToolResult> = new Map();

  constructor(connected = false, sessionId?: string) {
    this.connected = connected;
    this.sessionId = sessionId ?? null;
  }

  setConnected(connected: boolean, sessionId?: string): void {
    this.connected = connected;
    this.sessionId = connected ? (sessionId ?? `mock-${Date.now()}`) : null;
  }

  setMockResult(toolName: McpToolName, result: McpToolResult): void {
    this.mockResults.set(toolName, result);
  }

  async callTool(toolName: McpToolName, params: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.connected) {
      return { success: false, error: 'Gateway not connected' };
    }

    const mockResult = this.mockResults.get(toolName);
    if (mockResult) {
      return mockResult;
    }

    // Default success response
    return {
      success: true,
      result: {
        toolName,
        params,
        executedAt: new Date().toISOString(),
      },
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): GatewayStatus {
    if (this.connected) {
      return { connected: true, sessionId: this.sessionId! };
    }
    return { connected: false, reason: 'Not connected' };
  }
}

/**
 * Create an action executor with configuration
 */
export function createActionExecutor(config: ExecutorConfig): ActionExecutor {
  return new ActionExecutor(config);
}
