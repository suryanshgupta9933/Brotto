/**
 * Authentication helpers for the Brotto Platform SDK
 */
import type { FaraSDKError } from './errors.js';
export interface AuthConfig {
    /** OIDC issuer URL */
    oidcIssuer: string;
    /** OIDC client ID */
    oidcClientId: string;
    /** OIDC audience (optional, defaults to client ID) */
    oidcAudience?: string;
}
export interface TokenResponse {
    accessToken: string;
    expiresIn: number;
    tokenType: string;
    refreshToken?: string;
}
export interface DeviceTokenResponse {
    deviceToken: string;
    expiresAt: Date;
}
export interface OIDCTokens {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: Date;
}
/**
 * Options for refreshing tokens
 */
export interface RefreshTokenOptions {
    /** Refresh token */
    refreshToken: string;
    /** OIDC issuer URL */
    oidcIssuer: string;
    /** OIDC client ID */
    oidcClientId: string;
    /** OIDC audience (optional) */
    oidcAudience?: string;
    /** Scopes to request (optional) */
    scope?: string;
}
/**
 * Device registration options
 */
export interface DeviceRegistrationOptions {
    /** Device name/identifier */
    deviceName: string;
    /** OIDC tokens for authentication */
    tokens: OIDCTokens;
    /** API base URL */
    baseUrl: string;
}
/**
 * Token manager for handling token refresh and storage
 */
export declare class TokenManager {
    private oidcIssuer;
    private oidcClientId;
    private oidcAudience?;
    private accessToken;
    private refreshToken;
    private expiresAt;
    private refreshPromise;
    constructor(oidcIssuer: string, oidcClientId: string, oidcAudience?: string | undefined);
    /**
     * Set tokens from an OIDC token response
     */
    setTokens(tokens: OIDCTokens): void;
    /**
     * Get the current access token
     */
    getAccessToken(): string | null;
    /**
     * Get the current refresh token
     */
    getRefreshToken(): string | null;
    /**
     * Check if the current token is expired
     */
    isExpired(): boolean;
    /**
     * Check if a refresh token is available
     */
    hasRefreshToken(): boolean;
    /**
     * Refresh the access token using the refresh token
     */
    refresh(refreshToken?: string): Promise<string>;
    private doRefresh;
    /**
     * Clear all tokens
     */
    clear(): void;
    /**
     * Parse a JWT token without verification (for debugging/logging)
     */
    static parseJWT(token: string): Record<string, unknown> | null;
    /**
     * Get the expiration time from a JWT token
     */
    static getTokenExpiration(token: string): Date | null;
    /**
     * Check if a JWT token is expired
     */
    static isTokenExpired(token: string): boolean;
}
/**
 * OIDC discovery document
 */
export interface OIDCDiscoveryDocument {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint?: string;
    jwks_uri: string;
    end_session_endpoint?: string;
    grant_types_supported: string[];
    response_types_supported: string[];
    subject_types_supported: string[];
    id_token_signing_alg_values_supported: string[];
    token_endpoint_auth_methods_supported: string[];
    code_challenge_methods_supported?: string[];
}
/**
 * Fetch the OIDC discovery document
 */
export declare function fetchOIDCDiscovery(issuer: string): Promise<OIDCDiscoveryDocument>;
/**
 * Build the authorization URL for OIDC flow
 */
export declare function buildAuthorizationUrl(options: {
    authorizationEndpoint: string;
    clientId: string;
    redirectUri: string;
    state: string;
    nonce?: string;
    scope?: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256' | 'plain';
}): string;
/**
 * Exchange an authorization code for tokens
 */
export declare function exchangeCodeForTokens(options: {
    tokenEndpoint: string;
    clientId: string;
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    scopes?: string[];
}): Promise<TokenResponse>;
/**
 * Revoke a token
 */
export declare function revokeToken(options: {
    revocationEndpoint: string;
    clientId: string;
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
}): Promise<void>;
/**
 * Generate a random state parameter for OIDC flow
 */
export declare function generateState(): string;
/**
 * Generate a code verifier for PKCE
 */
export declare function generateCodeVerifier(): string;
/**
 * Generate a code challenge from a code verifier
 */
export declare function generateCodeChallenge(verifier: string): Promise<string>;
/**
 * Extract error information from fetch responses
 */
export declare function extractErrorFromResponse(response: Response): FaraSDKError;
//# sourceMappingURL=auth.d.ts.map