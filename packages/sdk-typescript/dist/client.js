/**
 * Main API client for the Brotto Platform SDK
 */
import { FaraSDKError, AuthenticationError, AuthorizationError, NotFoundError, ValidationError, RateLimitError, NetworkError, ServerError, } from './errors.js';
import { TokenManager } from './auth.js';
/**
 * Main API client for interacting with the Brotto Platform
 */
export class FaraClient {
    baseUrl;
    apiKey;
    tokenManager;
    timeout;
    maxRetries;
    onTokenRefresh;
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.timeout = config.timeout || 30000;
        this.maxRetries = config.maxRetries || 3;
        this.onTokenRefresh = config.onTokenRefresh;
        if (config.apiKey) {
            this.apiKey = config.apiKey;
            this.tokenManager = null;
        }
        else if (config.oidc) {
            this.apiKey = null;
            this.tokenManager = new TokenManager(config.oidc.issuer, config.oidc.clientId, config.oidc.audience);
            if (config.oidc.tokens) {
                this.tokenManager.setTokens({
                    accessToken: config.oidc.tokens.accessToken,
                    refreshToken: config.oidc.tokens.refreshToken,
                    expiresAt: config.oidc.tokens.expiresAt || new Date(),
                });
            }
        }
        else {
            throw new Error('Either apiKey or oidc configuration must be provided');
        }
    }
    /**
     * Get the authorization header value
     */
    async getAuthHeader() {
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
    async request(method, path, options = {}) {
        const url = new URL(`${this.baseUrl}${path}`);
        if (options.query) {
            Object.entries(options.query).forEach(([key, value]) => {
                if (value !== undefined) {
                    url.searchParams.append(key, String(value));
                }
            });
        }
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        const authHeader = await this.getAuthHeader();
        if (!headers['Authorization']) {
            headers['Authorization'] = authHeader;
        }
        let lastError = null;
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
                    const errorBody = await response.json().catch(() => ({}));
                    this.handleAPIError(response.status, errorBody);
                }
                return response.json();
            }
            catch (error) {
                lastError = error;
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
    handleAPIError(statusCode, error) {
        switch (statusCode) {
            case 401:
                throw new AuthenticationError(error.message, error.details);
            case 403:
                throw new AuthorizationError(error.message, error.details);
            case 404:
                throw new NotFoundError(error.message, undefined, error.details);
            case 400:
                throw new ValidationError(error.message, error.details, error.details);
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
    tasks = {
        /**
         * Create a new task
         */
        create: (input) => {
            return this.request('POST', '/tasks', { body: input });
        },
        /**
         * Get a task by ID
         */
        get: (taskId) => {
            return this.request('GET', `/tasks/${taskId}`);
        },
        /**
         * List tasks with optional filters
         */
        list: (options) => {
            return this.request('GET', '/tasks', {
                query: options,
            });
        },
        /**
         * Update a task
         */
        update: (taskId, input) => {
            return this.request('PATCH', `/tasks/${taskId}`, { body: input });
        },
        /**
         * Cancel a task
         */
        cancel: (taskId) => {
            return this.request('POST', `/tasks/${taskId}/cancel`);
        },
    };
    /**
     * Sessions API
     */
    sessions = {
        /**
         * Create a new session for a task
         */
        create: (input) => {
            return this.request('POST', '/sessions', { body: input });
        },
        /**
         * Get a session by ID
         */
        get: (sessionId) => {
            return this.request('GET', `/sessions/${sessionId}`);
        },
        /**
         * List sessions with optional filters
         */
        list: (options) => {
            return this.request('GET', '/sessions', {
                query: options,
            });
        },
        /**
         * Terminate a session
         */
        terminate: (sessionId, reason) => {
            return this.request('POST', `/sessions/${sessionId}/terminate`, {
                body: reason ? { reason } : undefined,
            });
        },
    };
    /**
     * Approvals API
     */
    approvals = {
        /**
         * Get an approval request by ID
         */
        get: (approvalId) => {
            return this.request('GET', `/approvals/${approvalId}`);
        },
        /**
         * List approval requests with optional filters
         */
        list: (options) => {
            return this.request('GET', '/approvals', {
                query: options,
            });
        },
        /**
         * Decide on an approval request
         */
        decide: (approvalId, decision) => {
            return this.request('POST', `/approvals/${approvalId}/decide`, {
                body: decision,
            });
        },
    };
    /**
     * Health check
     */
    async healthCheck() {
        return this.request('GET', '/health');
    }
    /**
     * Readiness check
     */
    async readinessCheck() {
        return this.request('GET', '/ready');
    }
    /**
     * Close the client and clean up resources
     */
    async close() {
        // Nothing to close for now, but interface allows for future cleanup
    }
}
/**
 * Create a client with API key authentication
 */
export function createClientWithAPIKey(baseUrl, apiKey, options) {
    return new FaraClient({ baseUrl, apiKey, ...options });
}
/**
 * Create a client with OIDC authentication
 */
export function createClientWithOIDC(baseUrl, oidc, options) {
    return new FaraClient({ baseUrl, oidc, ...options });
}
//# sourceMappingURL=client.js.map