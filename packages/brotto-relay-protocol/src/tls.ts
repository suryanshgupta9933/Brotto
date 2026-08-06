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
export const DEFAULT_TLS_CONFIG: TLSConfig = {
  enabled: true,
  mtlsEnabled: false,
  minVersion: 'TLSv1.3',
  verifyClient: false,
};

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
export function createServerTLSConfig(
  certFile: string,
  keyFile: string,
  options: {
    caFile?: string;
    verifyClient?: boolean;
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    cipherSuites?: string[];
  } = {}
): TLSConfig {
  return {
    enabled: true,
    certFile,
    keyFile,
    caFile: options.caFile,
    mtlsEnabled: false,
    minVersion: options.minVersion ?? 'TLSv1.3',
    cipherSuites: options.cipherSuites,
    verifyClient: options.verifyClient ?? false,
  };
}

/**
 * Create a client TLS configuration
 */
export function createClientTLSConfig(
  options: {
    certFile?: string;
    keyFile?: string;
    caFile?: string;
    mtlsEnabled?: boolean;
    mtlsCaFile?: string;
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    cipherSuites?: string[];
  } = {}
): TLSConfig {
  return {
    enabled: true,
    certFile: options.certFile,
    keyFile: options.keyFile,
    caFile: options.caFile,
    mtlsEnabled: options.mtlsEnabled ?? false,
    mtlsCaFile: options.mtlsCaFile,
    minVersion: options.minVersion ?? 'TLSv1.3',
    cipherSuites: options.cipherSuites,
    verifyClient: false,
  };
}

/**
 * Create an mTLS configuration for native connectors
 */
export function createMTLSConfig(
  clientCertFile: string,
  clientKeyFile: string,
  serverCaFile?: string
): TLSConfig {
  return {
    enabled: true,
    mtlsEnabled: true,
    clientCertFile,
    clientKeyFile,
    mtlsCaFile: serverCaFile,
    minVersion: 'TLSv1.3',
  };
}

/**
 * Validate TLS configuration
 */
export function validateTLSConfig(config: TLSConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.enabled) {
    errors.push('TLS must be enabled');
    return { isValid: false, errors };
  }

  if (config.minVersion && !['TLSv1.2', 'TLSv1.3'].includes(config.minVersion)) {
    errors.push(`Invalid TLS minVersion: ${config.minVersion}`);
  }

  // For mTLS, client cert/key are required
  if (config.mtlsEnabled) {
    if (!config.clientCertFile) {
      errors.push('mTLS enabled but clientCertFile not provided');
    }
    if (!config.clientKeyFile) {
      errors.push('mTLS enabled but clientKeyFile not provided');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a TLS configuration requires client certificates
 */
export function requiresClientCert(config: TLSConfig): boolean {
  return config.mtlsEnabled || config.verifyClient === true;
}

/**
 * Get TLS cipher suites for high security
 */
export function getSecureCipherSuites(): string[] {
  return [
    'TLS_AES_256_GCM_SHA384',
    'TLS_AES_128_GCM_SHA256',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
  ];
}

/**
 * Get TLS cipher suites for compatibility (TLS 1.2)
 */
export function getCompatibleCipherSuites(): string[] {
  return [
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-SHA384',
    'ECDHE-RSA-AES128-SHA256',
    'AES256-GCM-SHA384',
    'AES128-GCM-SHA256',
  ];
}

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
export function toNodeTLSOptions(config: TLSConfig): NodeTLSOptions {
  const options: NodeTLSOptions = {
    rejectUnauthorized: config.verifyClient,
    minVersion: config.minVersion,
  };

  if (config.keyFile) {
    options.key = readFileSync(config.keyFile);
  }
  if (config.certFile) {
    options.cert = readFileSync(config.certFile);
  }
  if (config.caFile) {
    options.ca = readFileSync(config.caFile);
  }
  if (config.cipherSuites && config.cipherSuites.length > 0) {
    options.ciphers = config.cipherSuites.join(':');
  }

  return options;
}

/**
 * Read file synchronously (helper for Node.js environments)
 * In browser environments, this would need to be handled differently
 */
function readFileSync(filePath: string): string {
  // This is a Node.js specific implementation
  // In browser environments, file reading would need to happen differently
  if (typeof require !== 'undefined') {
    try {
      const fs = require('fs');
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File not found or not readable
      return '';
    }
  }
  return '';
}

/**
 * Security options for TLS
 */
export const SECURITY_OPTIONS = {
  // Prevents fallback to insecure versions
  NoLegacyRenegotiation: true,
  // Enables OCSP stapling (if supported)
  enableOCSPStapling: true,
  // Enable TLS ticket rotation
  enableTLSTickets: true,
} as const;
