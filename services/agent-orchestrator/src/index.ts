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
  type InferenceConfig as LegacyInferenceConfig,
  type InferenceRequest,
  type InferenceResponse,
  type FaraToolCall,
  type FaraInferenceResult,
  InferenceError,
  isInferenceError,
} from './inference';

// Inference registry (multi-model)
export {
  createPlanner,
  inferFamilyFromEnv,
  type InferenceConfig,
  type InferenceFamily,
} from './inference-registry';

// Canonical stateless planner adapter
export {
  FaraPlanner,
  FaraPlannerError,
  FaraPlannerRequestError,
  type FaraPlannerConfig,
  type FaraPlannerDiagnostic,
  type FaraPlannerUsage,
} from './adapters/fara-planner';

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

// Canonical code-enforced policy adapter
export {
  PolicyAdapter,
  type PolicyAdapterConfig,
  type PolicyAdministratorOverrides,
  type PolicyCategory,
  type PolicyEvaluationDiagnostic,
} from './adapters/policy-adapter';

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

// Canonical deterministic completion verifier
export { CompletionVerifier } from './engine/completion-verifier';

// Public canonical composition ports for deterministic and production adapters.
export { SessionEngine } from './engine/session-engine.js';
export { InMemorySessionStore } from './engine/session-store.js';
export type {
  CanonicalSession,
  CommandSink,
  CompletionVerificationPort,
  EngineBudgets,
  InferencePort,
  PlanningInput,
  PlanningOutcome,
  PolicyInput,
  PolicyPort,
  SessionEngineEvent,
  SessionEngineOptions,
  SessionStore,
  StoredOutcome,
  TaskTerminalMessage,
  TerminalDelivery,
  TerminalNotification,
  TerminalSink,
  TrajectorySink,
} from './engine/types.js';
export { InferenceContractError, SessionEngineError } from './engine/types.js';

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

export { createOrchestratorApp, type OrchestratorAppOptions } from './app.js';
export {
  ConnectionAuthError,
  JoseConnectionTokenVerifier,
  InMemoryConnectionCredentialStore,
  createConnectionAuthenticator,
  type ConnectionClaims,
  type ConnectionTokenVerifier,
  type ConnectionCredentialStore,
} from './transport/auth.js';
export {
  InMemoryBrowserSessionBootstrapBackend,
  InMemoryBrowserSessionBootstrapStore,
  JoseConnectionCredentialCodec,
  createHmacEnvelopeSigner,
  registerBrowserSessionBootstrap,
  type BrowserSessionBootstrapOptions,
  type BrowserSessionBootstrapStore,
  type BrowserSessionRegistration,
  type ConnectionCredentialIssuer,
  type DeviceBootstrapAuthenticator,
  type DeviceBootstrapIdentity,
  type DeviceBootstrapInput,
} from './transport/bootstrap.js';
export {
  TransportError,
  TransportSession,
  AgentTransportHub,
  InMemoryConnectionLeaseStore,
  InMemoryConnectionLeaseBackend,
  OrderedOutboundQueue,
  connectionTokenFromProtocols,
  registerAgentWebSocket,
  type TransportEngine,
  type TransportResult,
  type ConnectionLeaseStore,
  type LeaseToken,
  type ConnectionEnvelopeSignerResolver,
} from './transport/ws-server.js';
