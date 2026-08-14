/**
 * Brotto Platform SDK - TypeScript
 *
 * Official TypeScript SDK for interacting with the Brotto Browser Automation Platform.
 * Provides typed clients for task creation, session management, and real-time events.
 */
export * from './types.js';
export * from './errors.js';
export { TokenManager, fetchOIDCDiscovery, buildAuthorizationUrl, exchangeCodeForTokens, revokeToken, generateState, generateCodeVerifier, generateCodeChallenge, } from './auth.js';
export type { AuthConfig, TokenResponse, DeviceTokenResponse, OIDCTokens, RefreshTokenOptions, DeviceRegistrationOptions, OIDCDiscoveryDocument, } from './auth.js';
export { isTerminalState, isActiveState, isWaitingState, getStateDescription, calculateSessionMetrics, filterEventsByType, filterEventsSince, filterEventsUntil, SessionReplay, isApprovalPending, isApprovalExpired, formatApprovalSummary, buildApprovalDecision, SESSION_STATE_DESCRIPTIONS, } from './session.js';
export type { SessionLease, WatchSessionOptions, SessionMetrics, SessionEventFilter, } from './session.js';
export { FaraClient, createClientWithAPIKey, createClientWithOIDC, } from './client.js';
export type { FaraClientConfig } from './client.js';
export { WebSocketClient, createWebSocketUrl, SessionEventIterator, watchSession, } from './websocket.js';
export type { WebSocketClientConfig } from './websocket.js';
//# sourceMappingURL=index.d.ts.map