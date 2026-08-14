/**
 * Authentication helpers for the Brotto Platform SDK
 */
/**
 * Token manager for handling token refresh and storage
 */
export class TokenManager {
    oidcIssuer;
    oidcClientId;
    oidcAudience;
    accessToken = null;
    refreshToken = null;
    expiresAt = null;
    refreshPromise = null;
    constructor(oidcIssuer, oidcClientId, oidcAudience) {
        this.oidcIssuer = oidcIssuer;
        this.oidcClientId = oidcClientId;
        this.oidcAudience = oidcAudience;
    }
    /**
     * Set tokens from an OIDC token response
     */
    setTokens(tokens) {
        this.accessToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken || null;
        this.expiresAt = tokens.expiresAt;
    }
    /**
     * Get the current access token
     */
    getAccessToken() {
        return this.accessToken;
    }
    /**
     * Get the current refresh token
     */
    getRefreshToken() {
        return this.refreshToken;
    }
    /**
     * Check if the current token is expired
     */
    isExpired() {
        if (!this.expiresAt) {
            return true;
        }
        // Add 30 second buffer to prevent using tokens that are about to expire
        return Date.now() >= this.expiresAt.getTime() - 30000;
    }
    /**
     * Check if a refresh token is available
     */
    hasRefreshToken() {
        return this.refreshToken !== null;
    }
    /**
     * Refresh the access token using the refresh token
     */
    async refresh(refreshToken) {
        const token = refreshToken || this.refreshToken;
        if (!token) {
            throw new Error('No refresh token available');
        }
        // Prevent concurrent refresh requests
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = this.doRefresh(token);
        try {
            const newToken = await this.refreshPromise;
            return newToken;
        }
        finally {
            this.refreshPromise = null;
        }
    }
    async doRefresh(refreshToken) {
        const tokenEndpoint = `${this.oidcIssuer}/oauth/token`;
        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.oidcClientId,
        });
        if (this.oidcAudience) {
            params.append('audience', this.oidcAudience);
        }
        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Token refresh failed: ${response.status} ${error}`);
        }
        const tokenResponse = await response.json();
        const expiresAt = new Date(Date.now() + tokenResponse.expiresIn * 1000);
        this.accessToken = tokenResponse.accessToken;
        if (tokenResponse.refreshToken) {
            this.refreshToken = tokenResponse.refreshToken;
        }
        this.expiresAt = expiresAt;
        return tokenResponse.accessToken;
    }
    /**
     * Clear all tokens
     */
    clear() {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
        this.refreshPromise = null;
    }
    /**
     * Parse a JWT token without verification (for debugging/logging)
     */
    static parseJWT(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                return null;
            }
            const payload = parts[1];
            const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
            return JSON.parse(decoded);
        }
        catch {
            return null;
        }
    }
    /**
     * Get the expiration time from a JWT token
     */
    static getTokenExpiration(token) {
        const payload = this.parseJWT(token);
        if (!payload || typeof payload.exp !== 'number') {
            return null;
        }
        return new Date(payload.exp * 1000);
    }
    /**
     * Check if a JWT token is expired
     */
    static isTokenExpired(token) {
        const exp = this.getTokenExpiration(token);
        if (!exp) {
            return true;
        }
        return Date.now() >= exp.getTime();
    }
}
/**
 * Fetch the OIDC discovery document
 */
export async function fetchOIDCDiscovery(issuer) {
    const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch OIDC discovery: ${response.status}`);
    }
    return response.json();
}
/**
 * Build the authorization URL for OIDC flow
 */
export function buildAuthorizationUrl(options) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        state: options.state,
        scope: options.scope || 'openid profile email',
    });
    if (options.nonce) {
        params.append('nonce', options.nonce);
    }
    if (options.codeChallenge) {
        params.append('code_challenge', options.codeChallenge);
        params.append('code_challenge_method', options.codeChallengeMethod || 'S256');
    }
    return `${options.authorizationEndpoint}?${params.toString()}`;
}
/**
 * Exchange an authorization code for tokens
 */
export async function exchangeCodeForTokens(options) {
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: options.code,
        redirect_uri: options.redirectUri,
        client_id: options.clientId,
    });
    if (options.codeVerifier) {
        params.append('code_verifier', options.codeVerifier);
    }
    if (options.scopes) {
        params.append('scope', options.scopes.join(' '));
    }
    const response = await fetch(options.tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Code exchange failed: ${response.status} ${error}`);
    }
    return response.json();
}
/**
 * Revoke a token
 */
export async function revokeToken(options) {
    const params = new URLSearchParams({
        client_id: options.clientId,
        token: options.token,
    });
    if (options.tokenTypeHint) {
        params.append('token_type_hint', options.tokenTypeHint);
    }
    const response = await fetch(options.revocationEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });
    // Ignore errors - revocation endpoint may not be available
    if (!response.ok) {
        console.warn(`Token revocation failed: ${response.status}`);
    }
}
/**
 * Generate a random state parameter for OIDC flow
 */
export function generateState() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/**
 * Generate a code verifier for PKCE
 */
export function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, Array.from(array)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}
/**
 * Generate a code challenge from a code verifier
 */
export async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}
/**
 * Extract error information from fetch responses
 */
export function extractErrorFromResponse(response) {
    // This is a placeholder - actual implementation would be in client.ts
    // returning appropriate SDK errors based on response
    return {
        code: response.status.toString(),
        statusCode: response.status,
        message: `HTTP ${response.status}: ${response.statusText}`,
        name: 'FaraSDKError',
    };
}
//# sourceMappingURL=auth.js.map