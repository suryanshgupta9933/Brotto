/**
 * Agent Orchestrator - Public API
 *
 * Core agent harness for Fara browser automation.
 *
 * @package @fara/agent-orchestrator
 */

// Session state machine
export {
  SessionStateMachine,
  SessionState,
  type SessionConfig,
  type SessionContext,
  type SessionHistoryEntry,
  InvalidStateTransitionError,
  isInvalidStateTransitionError,
} from './session';

// History management
export {
  HistoryManager,
  type HistoryEntry,
  type ScreenshotEntry,
  type MemoryEntry,
  type HistoryConfig,
  type HistoryStats,
  type PromptContext,
} from './history';

// Inference client
export {
  FaraInferenceClient,
  type InferenceConfig,
  type InferenceRequest,
  type InferenceResponse,
  type FaraToolCall,
  type FaraInferenceResult,
  InferenceError,
  isInferenceError,
} from './inference';

// Tool call parser
export {
  ToolCallParser,
  createToolCallParser,
  type ParsedAction,
  type ParseResult,
  type ParseError,
  ParseErrorCode,
} from './parser';

// Policy integration
export {
  PolicyIntegrator,
  createPolicyIntegrator,
  type PolicyConfig,
  type PolicyEvaluationOrchestratorResult,
} from './policy';

// MCP action executor
export {
  ActionExecutor,
  createActionExecutor,
  MockMcpGatewayClient,
  type McpGatewayClient,
  type McpToolResult,
  type GatewayStatus,
  type ExecutorConfig,
} from './executor';

// Completion and failure detection
export {
  CompletionDetector,
  createCompletionDetector,
  type CompletionDetectionResult,
  type FailureDetectionResult,
  FailureType,
  type AccessibilitySnapshotResult,
} from './completion';

// Budget tracking
export {
  AgentBudgetTracker,
  createAgentBudgetTracker,
  PRESET_BUDGETS,
  type BudgetEvent,
  BudgetEventType,
} from './budget';

// Retry and circuit breaker
export {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
  RetryHandler,
  ResilientExecutor,
  createResilientExecutor,
  RetryableError,
  type CircuitBreakerConfig,
  type RetryConfig,
} from './retry';

// Main orchestrator
export {
  AgentOrchestrator,
  createOrchestrator,
  type OrchestratorConfig,
  type OrchestratorEvents,
} from './server';
