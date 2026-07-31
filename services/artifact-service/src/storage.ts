/**
 * Storage Module - Encrypted Artifact Storage
 *
 * Implements AES-256 encryption for artifacts at rest.
 * Handles secure storage and retrieval of encrypted files.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { EncryptedArtifact } from './types.js';

export interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  tagLength: number;
  storageDir: string;
}

const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  algorithm: 'aes-256-gcm',
  keyLength: 32, // 256 bits
  ivLength: 16, // 128 bits for GCM
  tagLength: 16, // 128 bits
  storageDir: '/var/artifact-service/storage',
};

export interface StorageMetadata {
  artifactId: string;
  keyId: string;
  iv: string;
  authTag: string;
  originalSize: number;
  encryptedSize: number;
  storedAt: Date;
}

/**
 * Encrypted storage manager
 */
export class EncryptedStorageManager {
  private config: EncryptionConfig;
  private keyCache: Map<string, Buffer> = new Map();
  private storageMetadata: Map<string, StorageMetadata> = new Map();

  constructor(config: Partial<EncryptionConfig> = {}) {
    this.config = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };
    this.ensureStorageDir();
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.config.storageDir, { recursive: true });
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      // Ignore EEXIST (directory already exists) and EACCES (permission denied)
      // For EACCES, the directory might already exist with proper permissions
      if (nodeErr.code !== 'EEXIST' && nodeErr.code !== 'EACCES') {
        throw err;
      }
    }
  }

  /**
   * Generate a new encryption key
   */
  generateKey(): Buffer {
    return crypto.randomBytes(this.config.keyLength);
  }

  /**
   * Generate a new IV
   */
  generateIV(): Buffer {
    return crypto.randomBytes(this.config.ivLength);
  }

  /**
   * Get or create key for artifact
   */
  async getOrCreateKey(artifactId: string, tenantId: string): Promise<{ key: Buffer; keyId: string }> {
    // In production, keys should be stored in a KMS
    // This implementation uses a deterministic key derivation for demonstration
    const keyId = `key_${tenantId}_${artifactId}`;

    if (this.keyCache.has(keyId)) {
      return { key: this.keyCache.get(keyId)!, keyId };
    }

    // Generate a new key
    const key = this.generateKey();
    this.keyCache.set(keyId, key);

    return { key, keyId };
  }

  /**
   * Derive a key from artifact and tenant IDs (for key rotation)
   */
  deriveKey(artifactId: string, tenantId: string, version: number = 1): Buffer {
    const salt = `${tenantId}:${artifactId}:v${version}`;
    return crypto.pbkdf2Sync(
      process.env.ARTIFACT_ENCRYPTION_MASTER_KEY || crypto.randomBytes(32).toString('hex'),
      salt,
      100000,
      this.config.keyLength,
      'sha256'
    );
  }

  /**
   * Encrypt a file and store it
   */
  async encryptAndStore(
    sourcePath: string,
    artifactId: string,
    tenantId: string
  ): Promise<EncryptedArtifact> {
    const key = this.deriveKey(artifactId, tenantId);
    const keyId = `key_${tenantId}_${artifactId}`;
    const iv = this.generateIV();

    // Read source file
    const plaintext = await fs.readFile(sourcePath);

    // Encrypt using GCM mode
    const cipher = crypto.createCipheriv(this.config.algorithm, key, iv) as crypto.CipherGCM;

    // Encrypt the data
    const encryptedContent = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    // Get auth tag (must be called after final)
    const authTag = cipher.getAuthTag();

    // Combine encrypted content and auth tag
    const encrypted = Buffer.concat([encryptedContent, authTag]);

    // Write encrypted file
    const encryptedPath = path.join(this.config.storageDir, `${artifactId}.enc`);
    await fs.writeFile(encryptedPath, encrypted);

    // Store metadata
    const metadata: StorageMetadata = {
      artifactId,
      keyId,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      originalSize: plaintext.length,
      encryptedSize: encrypted.length,
      storedAt: new Date(),
    };
    this.storageMetadata.set(artifactId, metadata);

    return {
      artifactId,
      encryptedPath,
      encryptionKeyId: keyId,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      originalSize: plaintext.length,
      encryptedSize: encrypted.length,
    };
  }

  /**
   * Decrypt a stored artifact
   */
  async decryptAndRetrieve(
    artifactId: string,
    tenantId: string,
    destinationPath?: string
  ): Promise<Buffer> {
    const metadata = this.storageMetadata.get(artifactId);
    if (!metadata) {
      throw new Error(`Artifact ${artifactId} not found in storage`);
    }

    const key = this.deriveKey(artifactId, tenantId);
    const iv = Buffer.from(metadata.iv, 'hex');
    const authTag = Buffer.from(metadata.authTag, 'hex');

    // Read encrypted file
    const encrypted = await fs.readFile(path.join(this.config.storageDir, `${artifactId}.enc`));

    // Remove auth tag from end
    const encryptedContent = encrypted.subarray(0, encrypted.length - this.config.tagLength);
    const receivedAuthTag = encrypted.subarray(encrypted.length - this.config.tagLength);

    // Verify auth tag
    if (!authTag.equals(receivedAuthTag)) {
      throw new Error('Authentication tag mismatch - file may have been tampered with');
    }

    // Decrypt using GCM mode
    const decipher = crypto.createDecipheriv(this.config.algorithm, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedContent),
      decipher.final(),
    ]);

    // Write to destination if provided
    if (destinationPath) {
      await fs.writeFile(destinationPath, decrypted);
    }

    return decrypted;
  }

  /**
   * Check if artifact exists in storage
   */
  async exists(artifactId: string): Promise<boolean> {
    const encryptedPath = path.join(this.config.storageDir, `${artifactId}.enc`);
    try {
      await fs.access(encryptedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage metadata for artifact
   */
  getMetadata(artifactId: string): StorageMetadata | undefined {
    return this.storageMetadata.get(artifactId);
  }

  /**
   * Delete artifact from storage
   */
  async delete(artifactId: string): Promise<void> {
    const encryptedPath = path.join(this.config.storageDir, `${artifactId}.enc`);

    try {
      await fs.unlink(encryptedPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    this.storageMetadata.delete(artifactId);
  }

  /**
   * Get all stored artifacts for a tenant
   */
  async getArtifactsForTenant(tenantId: string): Promise<string[]> {
    const artifacts: string[] = [];
    const files = await fs.readdir(this.config.storageDir);

    for (const file of files) {
      if (file.endsWith('.enc')) {
        const artifactId = file.replace('.enc', '');
        const metadata = this.storageMetadata.get(artifactId);
        if (metadata && artifactId.includes(tenantId)) {
          artifacts.push(artifactId);
        }
      }
    }

    return artifacts;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalArtifacts: number;
    totalSize: number;
    storageDir: string;
  }> {
    const files = await fs.readdir(this.config.storageDir);
    let totalSize = 0;

    for (const file of files) {
      if (file.endsWith('.enc')) {
        const stats = await fs.stat(path.join(this.config.storageDir, file));
        totalSize += stats.size;
      }
    }

    return {
      totalArtifacts: files.filter(f => f.endsWith('.enc')).length,
      totalSize,
      storageDir: this.config.storageDir,
    };
  }

  /**
   * Clear all stored artifacts (for testing)
   */
  async clearAll(): Promise<void> {
    const files = await fs.readdir(this.config.storageDir);

    for (const file of files) {
      if (file.endsWith('.enc')) {
        await fs.unlink(path.join(this.config.storageDir, file));
      }
    }

    this.storageMetadata.clear();
    this.keyCache.clear();
  }
}

// Default singleton instance
let defaultStorageManager: EncryptedStorageManager | null = null;

export function getStorageManager(): EncryptedStorageManager {
  if (!defaultStorageManager) {
    defaultStorageManager = new EncryptedStorageManager();
  }
  return defaultStorageManager;
}

/**
 * Create a storage manager with custom configuration
 */
export function createStorageManager(config: Partial<EncryptionConfig>): EncryptedStorageManager {
  return new EncryptedStorageManager(config);
}
