/**
 * Validation Module - MIME Type and Checksum Validation
 *
 * Validates file MIME types and checksums for security and integrity.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import type { AllowedMimeTypes } from './types.js';

// Common safe MIME types for browser automation
const SAFE_MIME_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/xml',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
]);

// MIME types that require approval (potentially dangerous)
const APPROVAL_REQUIRED_MIME_TYPES = new Set([
  'application/javascript',
  'application/x-executable',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-python',
  'text/x-python',
  'text/x-script.python',
]);

// Dangerous MIME types that should always be rejected
const DANGEROUS_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-csh',
  'application/x-rsh',
]);

// File extension to MIME type mapping
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.json': ['application/json'],
  '.xml': ['application/xml'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv'],
  '.html': ['text/html'],
  '.htm': ['text/html'],
  '.css': ['text/css'],
  '.js': ['application/javascript', 'text/javascript'],
  '.mjs': ['application/javascript', 'text/javascript'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.svg': ['image/svg+xml'],
  '.mp4': ['video/mp4'],
  '.webm': ['video/webm'],
  '.mp3': ['audio/mpeg'],
  '.wav': ['audio/wav'],
  '.py': ['text/x-python', 'application/x-python-code'],
  '.sh': ['application/x-sh', 'application/x-shellscript'],
  '.exe': ['application/x-msdownload', 'application/x-executable'],
  '.dll': ['application/x-msdownload'],
};

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * MIME type validation result
 */
export interface MimeTypeValidation {
  valid: boolean;
  matchesExtension: boolean;
  matchesContent: boolean;
  requiresApproval: boolean;
  isDangerous: boolean;
  detectedMimeType?: string;
  errors: string[];
}

/**
 * Validate MIME type against allowed types
 */
export function validateMimeType(
  mimeType: string,
  allowedTypes?: AllowedMimeTypes
): MimeTypeValidation {
  const errors: string[] = [];
  let matchesExtension = false;
  let matchesContent = false;
  let requiresApproval = false;
  let isDangerous = false;

  // Check if MIME type is in dangerous list
  if (DANGEROUS_MIME_TYPES.has(mimeType.toLowerCase())) {
    errors.push(`MIME type ${mimeType} is classified as dangerous`);
    isDangerous = true;
  }

  // Check if MIME type requires approval
  if (APPROVAL_REQUIRED_MIME_TYPES.has(mimeType.toLowerCase())) {
    requiresApproval = true;
  }

  // Check if MIME type is in safe list
  if (!SAFE_MIME_TYPES.has(mimeType.toLowerCase()) && !isDangerous) {
    errors.push(`MIME type ${mimeType} is not in the safe list`);
  }

  // If allowed types configuration is provided, check against it
  if (allowedTypes) {
    const extension = getExtensionFromMimeType(mimeType);
    if (extension) {
      const allowedForExtension = allowedTypes.extensions[extension];
      if (allowedForExtension) {
        matchesExtension = allowedForExtension.some(
          t => t.toLowerCase() === mimeType.toLowerCase()
        );
        if (!matchesExtension) {
          errors.push(`MIME type ${mimeType} is not allowed for extension ${extension}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    matchesExtension,
    matchesContent,
    requiresApproval,
    isDangerous,
    detectedMimeType: mimeType,
    errors,
  };
}

/**
 * Validate file extension
 */
export function validateExtension(filename: string, mimeType: string): boolean {
  const ext = getFileExtension(filename).toLowerCase();
  const allowedMimes = EXTENSION_MIME_MAP[ext];
  if (!allowedMimes) {
    return false;
  }
  return allowedMimes.some(t => t.toLowerCase() === mimeType.toLowerCase());
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.substring(lastDot);
}

/**
 * Get extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string | undefined {
  for (const [ext, mimes] of Object.entries(EXTENSION_MIME_MAP)) {
    if (mimes.some(m => m.toLowerCase() === mimeType.toLowerCase())) {
      return ext;
    }
  }
  return undefined;
}

/**
 * Supported checksum algorithms
 */
export type ChecksumAlgorithm = 'sha256' | 'sha512' | 'md5';

/**
 * Calculate checksum of a file
 */
export async function calculateChecksum(
  filePath: string,
  algorithm: ChecksumAlgorithm = 'sha256'
): Promise<string> {
  const hash = crypto.createHash(algorithm);
  const fileHandle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(64 * 1024); // 64KB chunks
    let bytesRead: number;

    while ((bytesRead = (await fileHandle.read(buffer, 0, buffer.length)).bytesRead) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }

    return hash.digest('hex');
  } finally {
    await fileHandle.close();
  }
}

/**
 * Calculate checksum of a buffer
 */
export function calculateChecksumBuffer(
  buffer: Buffer,
  algorithm: ChecksumAlgorithm = 'sha256'
): string {
  const hash = crypto.createHash(algorithm);
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * Verify checksum matches expected value
 */
export function verifyChecksum(
  calculatedChecksum: string,
  expectedChecksum: string,
  _algorithm: ChecksumAlgorithm = 'sha256'
): boolean {
  // Normalize checksums to lowercase hex
  const normalizedCalc = calculatedChecksum.toLowerCase();
  const normalizedExp = expectedChecksum.toLowerCase();

  // Constant-time comparison to prevent timing attacks
  if (normalizedCalc.length !== normalizedExp.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < normalizedCalc.length; i++) {
    result |= normalizedCalc.charCodeAt(i) ^ normalizedExp.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Full file validation result
 */
export interface FileValidationResult {
  valid: boolean;
  mimeTypeValid: boolean;
  checksumValid: boolean;
  sizeValid: boolean;
  errors: string[];
  warnings: string[];
  detectedMimeType?: string;
  calculatedChecksum?: string;
}

/**
 * Comprehensive file validation
 */
export async function validateFile(
  filePath: string,
  filename: string,
  expectedMimeType: string,
  expectedChecksum: string,
  expectedSize: number,
  maxSize?: number,
  allowedTypes?: AllowedMimeTypes
): Promise<FileValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate file exists and get stats
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    return {
      valid: false,
      mimeTypeValid: false,
      checksumValid: false,
      sizeValid: false,
      errors: [`File not found: ${filePath}`],
      warnings: [],
    };
  }

  // Validate size
  const sizeValid = maxSize ? stats.size <= maxSize : stats.size === expectedSize;
  if (!sizeValid) {
    if (maxSize && stats.size > maxSize) {
      errors.push(`File size ${stats.size} exceeds maximum allowed ${maxSize}`);
    } else if (stats.size !== expectedSize) {
      errors.push(`File size ${stats.size} does not match expected ${expectedSize}`);
    }
  }

  // Validate MIME type
  const mimeValidation = validateMimeType(expectedMimeType, allowedTypes);
  if (!mimeValidation.valid) {
    errors.push(...mimeValidation.errors);
  }
  if (mimeValidation.requiresApproval) {
    warnings.push(`MIME type ${expectedMimeType} requires approval before processing`);
  }
  if (mimeValidation.isDangerous) {
    errors.push(`Dangerous MIME type ${expectedMimeType} is not allowed`);
  }

  // Validate extension matches MIME type
  if (!validateExtension(filename, expectedMimeType)) {
    warnings.push(`Filename extension may not match MIME type ${expectedMimeType}`);
  }

  // Calculate and verify checksum
  let checksumValid = false;
  let calculatedChecksum: string | undefined;

  try {
    // Determine algorithm from checksum length
    const algorithm = getAlgorithmFromChecksum(expectedChecksum);
    calculatedChecksum = await calculateChecksum(filePath, algorithm);
    checksumValid = verifyChecksum(calculatedChecksum, expectedChecksum, algorithm);

    if (!checksumValid) {
      errors.push(`Checksum mismatch: expected ${expectedChecksum}, got ${calculatedChecksum}`);
    }
  } catch (err) {
    errors.push(`Failed to calculate checksum: ${(err as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    mimeTypeValid: mimeValidation.valid,
    checksumValid,
    sizeValid,
    errors,
    warnings,
    detectedMimeType: mimeValidation.detectedMimeType,
    calculatedChecksum,
  };
}

/**
 * Infer algorithm from checksum length
 */
export function getAlgorithmFromChecksum(checksum: string): ChecksumAlgorithm {
  const len = checksum.length;
  if (len === 64) return 'sha256';
  if (len === 128) return 'sha512';
  if (len === 32) return 'md5';
  throw new Error(`Unknown checksum algorithm for length ${len}`);
}

/**
 * Detect MIME type from file content (magic bytes)
 */
export async function detectMimeTypeFromContent(filePath: string): Promise<string> {
  const buffer = Buffer.alloc(512);
  const fileHandle = await fs.open(filePath, 'r');

  try {
    await fileHandle.read(buffer, 0, buffer.length, 0);
  } finally {
    await fileHandle.close();
  }

  // Check magic bytes
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    return 'application/zip';
  }
  if (buffer[0] === 0x3C && buffer[1] === 0x3F) {
    return 'text/xml'; // or text/html
  }
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    return 'application/x-executable';
  }

  return 'application/octet-stream';
}

/**
 * Validation service for artifact files
 */
export class FileValidationService {
  private allowedTypes: AllowedMimeTypes;
  private maxFileSize: number;

  constructor(allowedTypes?: AllowedMimeTypes, maxFileSize?: number) {
    this.allowedTypes = allowedTypes || {
      extensions: EXTENSION_MIME_MAP,
      maxSize: maxFileSize || 100 * 1024 * 1024, // 100MB default
      checkContent: true,
    };
    this.maxFileSize = this.allowedTypes.maxSize;
  }

  /**
   * Validate an uploaded file
   */
  async validateUpload(
    filePath: string,
    filename: string,
    mimeType: string,
    checksum: string,
    size: number
  ): Promise<FileValidationResult> {
    return validateFile(
      filePath,
      filename,
      mimeType,
      checksum,
      size,
      this.maxFileSize,
      this.allowedTypes
    );
  }

  /**
   * Set allowed MIME types
   */
  setAllowedTypes(types: AllowedMimeTypes): void {
    this.allowedTypes = types;
    this.maxFileSize = types.maxSize;
  }

  /**
   * Get current allowed types configuration
   */
  getAllowedTypes(): AllowedMimeTypes {
    return this.allowedTypes;
  }
}
