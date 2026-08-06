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
export class TokenManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: Date | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private oidcIssuer: string,
    private oidcClientId: string,
    private oidcAudience?: string
  ) {}

  /**
   * Set tokens from an OIDC token response
   */
  setTokens(tokens: OIDCTokens): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken || null;
    this.expiresAt = tokens.expiresAt;
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Get the current refresh token
   */
  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /**
   * Check if the current token is expired
   */
  isExpired(): boolean {
    if (!this.expiresAt) {
      return true;
    }
    // Add 30 second buffer to prevent using tokens that are about to expire
    return Date.now() >= this.expiresAt.getTime() - 30000;
  }

  /**
   * Check if a refresh token is available
   */
  hasRefreshToken(): boolean {
    return this.refreshToken !== null;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refresh(refreshToken?: string): Promise<string> {
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
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(refreshToken: string): Promise<string> {
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

    const tokenResponse: TokenResponse = await response.json();

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
  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
    this.refreshPromise = null;
  }

  /**
   * Parse a JWT token without verification (for debugging/logging)
   */
  static parseJWT(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }
      const payload = parts[1];
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }

  /**
   * Get the expiration time from a JWT token
   */
  static getTokenExpiration(token: string): Date | null {
    const payload = this.parseJWT(token);
    if (!payload || typeof payload.exp !== 'number') {
      return null;
    }
    return new Date(payload.exp * 1000);
  }

  /**
   * Check if a JWT token is expired
   */
  static isTokenExpired(token: string): boolean {
    const exp = this.getTokenExpiration(token);
    if (!exp) {
      return true;
    }
    return Date.now() >= exp.getTime();
  }
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
export async function fetchOIDCDiscovery(
  issuer: string
): Promise<OIDCDiscoveryDocument> {
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
export function buildAuthorizationUrl(options: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce?: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
}): string {
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
export async function exchangeCodeForTokens(options: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  scopes?: string[];
}): Promise<TokenResponse> {
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
export async function revokeToken(options: {
  revocationEndpoint: string;
  clientId: string;
  token: string;
  tokenTypeHint?: 'access_token' | 'refresh_token';
}): Promise<void> {
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
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a code verifier for PKCE
 */
export function generateCodeVerifier(): string {
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
export async function generateCodeChallenge(verifier: string): Promise<string> {
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
export function extractErrorFromResponse(response: Response): FaraSDKError {
  // This is a placeholder - actual implementation would be in client.ts
  // returning appropriate SDK errors based on response
  return {
    code: response.status.toString(),
    statusCode: response.status,
    message: `HTTP ${response.status}: ${response.statusText}`,
    name: 'FaraSDKError',
  } as FaraSDKError;
}
