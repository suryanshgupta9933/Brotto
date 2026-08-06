/**
 * Brotto Platform SDK - TypeScript
 *
 * Official TypeScript SDK for interacting with the Brotto Browser Automation Platform.
 * Provides typed clients for task creation, session management, and real-time events.
 */

// Types
export * from './types.js';

// Errors
export * from './errors.js';

// Auth helpers
export {
  TokenManager,
  fetchOIDCDiscovery,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  revokeToken,
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
} from './auth.js';

export type {
  AuthConfig,
  TokenResponse,
  DeviceTokenResponse,
  OIDCTokens,
  RefreshTokenOptions,
  DeviceRegistrationOptions,
  OIDCDiscoveryDocument,
} from './auth.js';

// Session helpers
export {
  isTerminalState,
  isActiveState,
  isWaitingState,
  getStateDescription,
  calculateSessionMetrics,
  filterEventsByType,
  filterEventsSince,
  filterEventsUntil,
  SessionReplay,
  isApprovalPending,
  isApprovalExpired,
  formatApprovalSummary,
  buildApprovalDecision,
  SESSION_STATE_DESCRIPTIONS,
} from './session.js';

export type {
  SessionLease,
  WatchSessionOptions,
  SessionMetrics,
  SessionEventFilter,
} from './session.js';

// Client
export {
  FaraClient,
  createClientWithAPIKey,
  createClientWithOIDC,
} from './client.js';

export type { FaraClientConfig } from './client.js';

// WebSocket
export {
  WebSocketClient,
  createWebSocketUrl,
  SessionEventIterator,
  watchSession,
} from './websocket.js';

export type { WebSocketClientConfig } from './websocket.js';
