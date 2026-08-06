/**
 * Main API client for the Brotto Platform SDK
 */

import type {
  Task,
  Session,
  ApprovalRequest,
  PaginatedResponse,
  CreateTaskInput,
  UpdateTaskInput,
  CreateSessionInput,
  ApprovalDecision,
  SessionEvent,
} from './types.js';
import type { SessionState } from './types.js';
import {
  FaraSDKError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  NetworkError,
  TaskNotFoundError,
  SessionNotFoundError,
  ApprovalNotFoundError,
  ApprovalAlreadyDecidedError,
  ApprovalExpiredError,
  ServerError,
} from './errors.js';
import { TokenManager, type TokenManager } from './auth.js';

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

interface APIErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
}

/**
 * Main API client for interacting with the Brotto Platform
 */
export class FaraClient {
  private baseUrl: string;
  private apiKey: string | null;
  private tokenManager: TokenManager | null;
  private timeout: number;
  private maxRetries: number;
  private onTokenRefresh?: (accessToken: string) => void;

  constructor(config: FaraClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.onTokenRefresh = config.onTokenRefresh;

    if (config.apiKey) {
      this.apiKey = config.apiKey;
      this.tokenManager = null;
    } else if (config.oidc) {
      this.apiKey = null;
      this.tokenManager = new TokenManager(
        config.oidc.issuer,
        config.oidc.clientId,
        config.oidc.audience
      );
      if (config.oidc.tokens) {
        this.tokenManager.setTokens({
          accessToken: config.oidc.tokens.accessToken,
          refreshToken: config.oidc.tokens.refreshToken,
          expiresAt: config.oidc.tokens.expiresAt || new Date(),
        });
      }
    } else {
      throw new Error('Either apiKey or oidc configuration must be provided');
    }
  }

  /**
   * Get the authorization header value
   */
  private async getAuthHeader(): Promise<string> {
    if (this.apiKey) {
      return `Bearer ${this.apiKey}`;
    }

    if (this.tokenManager) {
      if (this.tokenManager.isExpired() && this.tokenManager.hasRefreshToken()) {
        const newToken = await this.tokenManager.refresh();
        this.onTokenRefresh?.(newToken);
        return `Bearer ${newToken}`;
      }
      const token = this.tokenManager.getAccessToken();
      if (!token) {
        throw new AuthenticationError('No authentication token available');
      }
      return `Bearer ${token}`;
    }

    throw new AuthenticationError('No authentication configured');
  }

  /**
   * Make an authenticated request
   */
  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const authHeader = await this.getAuthHeader();
    if (!headers['Authorization']) {
      headers['Authorization'] = authHeader;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url.toString(), {
          method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({})) as APIErrorResponse;
          this.handleAPIError(response.status, errorBody);
        }

        return response.json() as Promise<T>;
      } catch (error) {
        lastError = error as Error;

        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw new FaraSDKError('Request timed out', 'TIMEOUT', 0);
          }
          if (error instanceof FaraSDKError) {
            throw error;
          }
        }

        // Don't retry on client errors (4xx)
        if (lastError instanceof FaraSDKError && lastError.statusCode >= 400 && lastError.statusCode < 500) {
          throw lastError;
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          break;
        }

        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    throw new NetworkError(`Request failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Handle API error responses
   */
  private handleAPIError(statusCode: number, error: APIErrorResponse): never {
    switch (statusCode) {
      case 401:
        throw new AuthenticationError(error.message, error.details);
      case 403:
        throw new AuthorizationError(error.message, error.details);
      case 404:
        throw new NotFoundError(error.message, undefined, error.details);
      case 400:
        throw new ValidationError(error.message, error.details as unknown[] | undefined, error.details);
      case 429:
        throw new RateLimitError(error.message, undefined, error.details);
      default:
        if (statusCode >= 500) {
          throw new ServerError(error.message, error.details);
        }
        throw new FaraSDKError(error.message, error.error, statusCode, error.details);
    }
  }

  /**
   * Tasks API
   */
  readonly tasks = {
    /**
     * Create a new task
     */
    create: (input: CreateTaskInput): Promise<{ task: Task }> => {
      return this.request<{ task: Task }>('POST', '/tasks', { body: input });
    },

    /**
     * Get a task by ID
     */
    get: (taskId: string): Promise<{ task: Task }> => {
      return this.request<{ task: Task }>('GET', `/tasks/${taskId}`);
    },

    /**
     * List tasks with optional filters
     */
    list: (options?: {
      page?: number;
      limit?: number;
      status?: string;
      deviceId?: string;
    }): Promise<PaginatedResponse<Task>> => {
      return this.request<PaginatedResponse<Task>>('GET', '/tasks', {
        query: options as Record<string, string | number | boolean | undefined>,
      });
    },

    /**
     * Update a task
     */
    update: (taskId: string, input: UpdateTaskInput): Promise<{ task: Task }> => {
      return this.request<{ task: Task }>('PATCH', `/tasks/${taskId}`, { body: input });
    },

    /**
     * Cancel a task
     */
    cancel: (taskId: string): Promise<{ message: string }> => {
      return this.request<{ message: string }>('POST', `/tasks/${taskId}/cancel`);
    },
  };

  /**
   * Sessions API
   */
  readonly sessions = {
    /**
     * Create a new session for a task
     */
    create: (input: CreateSessionInput): Promise<{ session: Session }> => {
      return this.request<{ session: Session }>('POST', '/sessions', { body: input });
    },

    /**
     * Get a session by ID
     */
    get: (sessionId: string): Promise<{ session: Session }> => {
      return this.request<{ session: Session }>('GET', `/sessions/${sessionId}`);
    },

    /**
     * List sessions with optional filters
     */
    list: (options?: {
      page?: number;
      limit?: number;
      status?: SessionState;
      taskId?: string;
    }): Promise<PaginatedResponse<Session>> => {
      return this.request<PaginatedResponse<Session>>('GET', '/sessions', {
        query: options as Record<string, string | number | boolean | undefined>,
      });
    },

    /**
     * Terminate a session
     */
    terminate: (sessionId: string, reason?: string): Promise<{ message: string }> => {
      return this.request<{ message: string }>('POST', `/sessions/${sessionId}/terminate`, {
        body: reason ? { reason } : undefined,
      });
    },
  };

  /**
   * Approvals API
   */
  readonly approvals = {
    /**
     * Get an approval request by ID
     */
    get: (approvalId: string): Promise<{ approval: ApprovalRequest }> => {
      return this.request<{ approval: ApprovalRequest }>('GET', `/approvals/${approvalId}`);
    },

    /**
     * List approval requests with optional filters
     */
    list: (options?: {
      page?: number;
      limit?: number;
      status?: 'pending' | 'approved' | 'denied' | 'expired';
      sessionId?: string;
      taskId?: string;
    }): Promise<PaginatedResponse<ApprovalRequest>> => {
      return this.request<PaginatedResponse<ApprovalRequest>>('GET', '/approvals', {
        query: options as Record<string, string | number | boolean | undefined>,
      });
    },

    /**
     * Decide on an approval request
     */
    decide: (approvalId: string, decision: ApprovalDecision): Promise<{ approval: ApprovalRequest }> => {
      return this.request<{ approval: ApprovalRequest }>('POST', `/approvals/${approvalId}/decide`, {
        body: decision,
      });
    },
  };

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('GET', '/health');
  }

  /**
   * Readiness check
   */
  async readinessCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('GET', '/ready');
  }

  /**
   * Close the client and clean up resources
   */
  async close(): Promise<void> {
    // Nothing to close for now, but interface allows for future cleanup
  }
}

/**
 * Create a client with API key authentication
 */
export function createClientWithAPIKey(baseUrl: string, apiKey: string, options?: Partial<FaraClientConfig>): FaraClient {
  return new FaraClient({ baseUrl, apiKey, ...options });
}

/**
 * Create a client with OIDC authentication
 */
export function createClientWithOIDC(
  baseUrl: string,
  oidc: NonNullable<FaraClientConfig['oidc']>,
  options?: Partial<FaraClientConfig>
): FaraClient {
  return new FaraClient({ baseUrl, oidc, ...options });
}

export type { FaraClientConfig, TokenManager };
