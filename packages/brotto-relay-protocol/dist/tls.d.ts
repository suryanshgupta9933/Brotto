/**
 * TLS/mTLS configuration types
 *
 * Defines configuration for secure transport.
 * TLS is required for all connections.
 * Mutual TLS (mTLS) is used for native connectors.
 */
import { TLSConfig } from './types.js';
/**
 * Default TLS configuration (most secure defaults)
 */
export declare const DEFAULT_TLS_CONFIG: TLSConfig;
/**
 * TLS configuration for server-side connections
 */
export interface ServerTLSConfig extends TLSConfig {
    certFile: string;
    keyFile: string;
}
/**
 * TLS configuration for client-side connections
 */
export interface ClientTLSConfig extends TLSConfig {
    certFile?: string;
    keyFile?: string;
}
/**
 * MTLS configuration for native connectors
 */
export interface MTLSConfig extends TLSConfig {
    clientCertFile: string;
    clientKeyFile: string;
    serverCaFile?: string;
}
/**
 * Create a server TLS configuration
 */
export declare function createServerTLSConfig(certFile: string, keyFile: string, options?: {
    caFile?: string;
    verifyClient?: boolean;
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    cipherSuites?: string[];
}): TLSConfig;
/**
 * Create a client TLS configuration
 */
export declare function createClientTLSConfig(options?: {
    certFile?: string;
    keyFile?: string;
    caFile?: string;
    mtlsEnabled?: boolean;
    mtlsCaFile?: string;
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    cipherSuites?: string[];
}): TLSConfig;
/**
 * Create an mTLS configuration for native connectors
 */
export declare function createMTLSConfig(clientCertFile: string, clientKeyFile: string, serverCaFile?: string): TLSConfig;
/**
 * Validate TLS configuration
 */
export declare function validateTLSConfig(config: TLSConfig): {
    isValid: boolean;
    errors: string[];
};
/**
 * Check if a TLS configuration requires client certificates
 */
export declare function requiresClientCert(config: TLSConfig): boolean;
/**
 * Get TLS cipher suites for high security
 */
export declare function getSecureCipherSuites(): string[];
/**
 * Get TLS cipher suites for compatibility (TLS 1.2)
 */
export declare function getCompatibleCipherSuites(): string[];
/**
 * TLS connection options for Node.js tls module
 */
export interface NodeTLSOptions {
    key?: string;
    cert?: string;
    ca?: string;
    rejectUnauthorized?: boolean;
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    ciphers?: string;
    honorCipherOrder?: boolean;
}
/**
 * Convert our TLSConfig to Node.js tls options
 */
export declare function toNodeTLSOptions(config: TLSConfig): NodeTLSOptions;
/**
 * Security options for TLS
 */
export declare const SECURITY_OPTIONS: {
    readonly NoLegacyRenegotiation: true;
    readonly enableOCSPStapling: true;
    readonly enableTLSTickets: true;
};
//# sourceMappingURL=tls.d.ts.map