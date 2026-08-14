/**
 * Main API client for the Brotto Platform SDK
 */
import type { Task, Session, ApprovalRequest, PaginatedResponse, CreateTaskInput, UpdateTaskInput, CreateSessionInput, ApprovalDecision } from './types.js';
import type { SessionState } from './types.js';
import { TokenManager } from './auth.js';
export interface FaraClientConfig {
    /** API base URL */
    baseUrl: string;
    /** API key for authentication (alternative to OIDC) */
    apiKey?: string;
    /** OIDC configuration (if using OIDC authentication) */
    oidc?: {
        issuer: string;
        clientId: string;
        audience?: string;
        tokens?: {
            accessToken: string;
            refreshToken?: string;
            expiresAt?: Date;
        };
    };
    /** Request timeout in milliseconds */
    timeout?: number;
    /** Maximum retries for failed requests */
    maxRetries?: number;
    /** Called when token is refreshed */
    onTokenRefresh?: (accessToken: string) => void;
}
/**
 * Main API client for interacting with the Brotto Platform
 */
export declare class FaraClient {
    private baseUrl;
    private apiKey;
    private tokenManager;
    private timeout;
    private maxRetries;
    private onTokenRefresh?;
    constructor(config: FaraClientConfig);
    /**
     * Get the authorization header value
     */
    private getAuthHeader;
    /**
     * Make an authenticated request
     */
    private request;
    /**
     * Handle API error responses
     */
    private handleAPIError;
    /**
     * Tasks API
     */
    readonly tasks: {
        /**
         * Create a new task
         */
        create: (input: CreateTaskInput) => Promise<{
            task: Task;
        }>;
        /**
         * Get a task by ID
         */
        get: (taskId: string) => Promise<{
            task: Task;
        }>;
        /**
         * List tasks with optional filters
         */
        list: (options?: {
            page?: number;
            limit?: number;
            status?: string;
            deviceId?: string;
        }) => Promise<PaginatedResponse<Task>>;
        /**
         * Update a task
         */
        update: (taskId: string, input: UpdateTaskInput) => Promise<{
            task: Task;
        }>;
        /**
         * Cancel a task
         */
        cancel: (taskId: string) => Promise<{
            message: string;
        }>;
    };
    /**
     * Sessions API
     */
    readonly sessions: {
        /**
         * Create a new session for a task
         */
        create: (input: CreateSessionInput) => Promise<{
            session: Session;
        }>;
        /**
         * Get a session by ID
         */
        get: (sessionId: string) => Promise<{
            session: Session;
        }>;
        /**
         * List sessions with optional filters
         */
        list: (options?: {
            page?: number;
            limit?: number;
            status?: SessionState;
            taskId?: string;
        }) => Promise<PaginatedResponse<Session>>;
        /**
         * Terminate a session
         */
        terminate: (sessionId: string, reason?: string) => Promise<{
            message: string;
        }>;
    };
    /**
     * Approvals API
     */
    readonly approvals: {
        /**
         * Get an approval request by ID
         */
        get: (approvalId: string) => Promise<{
            approval: ApprovalRequest;
        }>;
        /**
         * List approval requests with optional filters
         */
        list: (options?: {
            page?: number;
            limit?: number;
            status?: "pending" | "approved" | "denied" | "expired";
            sessionId?: string;
            taskId?: string;
        }) => Promise<PaginatedResponse<ApprovalRequest>>;
        /**
         * Decide on an approval request
         */
        decide: (approvalId: string, decision: ApprovalDecision) => Promise<{
            approval: ApprovalRequest;
        }>;
    };
    /**
     * Health check
     */
    healthCheck(): Promise<{
        status: string;
        timestamp: string;
    }>;
    /**
     * Readiness check
     */
    readinessCheck(): Promise<{
        status: string;
        timestamp: string;
    }>;
    /**
     * Close the client and clean up resources
     */
    close(): Promise<void>;
}
/**
 * Create a client with API key authentication
 */
export declare function createClientWithAPIKey(baseUrl: string, apiKey: string, options?: Partial<FaraClientConfig>): FaraClient;
/**
 * Create a client with OIDC authentication
 */
export declare function createClientWithOIDC(baseUrl: string, oidc: NonNullable<FaraClientConfig['oidc']>, options?: Partial<FaraClientConfig>): FaraClient;
export type { FaraClientConfig, TokenManager };
//# sourceMappingURL=client.d.ts.map