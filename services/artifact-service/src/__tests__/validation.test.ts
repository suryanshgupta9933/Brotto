/**
 * Validation Module Tests
 */

import {
  validateMimeType,
  validateExtension,
  getFileExtension,
  getExtensionFromMimeType,
  calculateChecksumBuffer,
  verifyChecksum,
  getAlgorithmFromChecksum,
  FileValidationService,
} from '../validation.js';

describe('Validation Module', () => {
  describe('validateMimeType', () => {
    it('should accept safe MIME types', () => {
      const result = validateMimeType('application/pdf');
      expect(result.valid).toBe(true);
      expect(result.isDangerous).toBe(false);
      expect(result.requiresApproval).toBe(false);
    });

    it('should reject dangerous MIME types', () => {
      const result = validateMimeType('application/x-executable');
      expect(result.valid).toBe(false);
      expect(result.isDangerous).toBe(true);
    });

    it('should flag MIME types requiring approval', () => {
      const result = validateMimeType('application/javascript');
      expect(result.requiresApproval).toBe(true);
    });

    it('should accept unknown MIME types that are not dangerous', () => {
      const result = validateMimeType('application/x-custom');
      expect(result.valid).toBe(false); // Not in safe list
      expect(result.isDangerous).toBe(false);
    });
  });

  describe('validateExtension', () => {
    it('should return true for matching extension and MIME type', () => {
      expect(validateExtension('file.pdf', 'application/pdf')).toBe(true);
      expect(validateExtension('file.png', 'image/png')).toBe(true);
      expect(validateExtension('file.jpg', 'image/jpeg')).toBe(true);
    });

    it('should return false for mismatched extension and MIME type', () => {
      expect(validateExtension('file.pdf', 'image/png')).toBe(false);
      expect(validateExtension('file.txt', 'application/pdf')).toBe(false);
    });
  });

  describe('getFileExtension', () => {
    it('should extract file extension', () => {
      expect(getFileExtension('file.txt')).toBe('.txt');
      expect(getFileExtension('file.tar.gz')).toBe('.gz');
      expect(getFileExtension('file')).toBe('');
      expect(getFileExtension('file.')).toBe('');
    });
  });

  describe('getExtensionFromMimeType', () => {
    it('should return extension for known MIME type', () => {
      expect(getExtensionFromMimeType('application/pdf')).toBe('.pdf');
      expect(getExtensionFromMimeType('image/png')).toBe('.png');
      expect(getExtensionFromMimeType('text/plain')).toBe('.txt');
    });

    it('should return undefined for unknown MIME type', () => {
      expect(getExtensionFromMimeType('application/x-custom')).toBeUndefined();
    });
  });

  describe('calculateChecksumBuffer', () => {
    it('should calculate SHA256 checksum', () => {
      const buffer = Buffer.from('hello world');
      const checksum = calculateChecksumBuffer(buffer, 'sha256');
      expect(checksum).toBe(
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
    });

    it('should calculate MD5 checksum', () => {
      const buffer = Buffer.from('hello world');
      const checksum = calculateChecksumBuffer(buffer, 'md5');
      expect(checksum).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
    });

    it('should calculate SHA512 checksum', () => {
      const buffer = Buffer.from('hello world');
      const checksum = calculateChecksumBuffer(buffer, 'sha512');
      // SHA512 hash of "hello world"
      expect(checksum).toBe(
        '309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f'
      );
    });
  });

  describe('verifyChecksum', () => {
    it('should verify matching checksums', () => {
      const checksum =
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      expect(verifyChecksum(checksum, checksum)).toBe(true);
    });

    it('should reject non-matching checksums', () => {
      const checksum1 =
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      const checksum2 =
        '0000000000000000000000000000000000000000000000000000000000000000';
      expect(verifyChecksum(checksum1, checksum2)).toBe(false);
    });

    it('should handle case-insensitive comparison', () => {
      const checksum1 = 'ABCDEF';
      const checksum2 = 'abcdef';
      expect(verifyChecksum(checksum1, checksum2)).toBe(true);
    });
  });

  describe('getAlgorithmFromChecksum', () => {
    it('should detect SHA256 from length', () => {
      expect(getAlgorithmFromChecksum('a'.repeat(64))).toBe('sha256');
    });

    it('should detect SHA512 from length', () => {
      expect(getAlgorithmFromChecksum('a'.repeat(128))).toBe('sha512');
    });

    it('should detect MD5 from length', () => {
      expect(getAlgorithmFromChecksum('a'.repeat(32))).toBe('md5');
    });

    it('should throw for unknown length', () => {
      expect(() => getAlgorithmFromChecksum('a'.repeat(50))).toThrow();
    });
  });

  describe('FileValidationService', () => {
    let service: FileValidationService;

    beforeEach(() => {
      service = new FileValidationService();
    });

    it('should return invalid for non-existent file', async () => {
      const result = await service.validateUpload(
        '/nonexistent/file.txt',
        'file.txt',
        'text/plain',
        'abc123',
        100
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('File not found: /nonexistent/file.txt');
    });

    it('should reject files exceeding max size', async () => {
      // Create a service with very small max size
      const smallService = new FileValidationService(
        {
          extensions: {},
          maxSize: 10,
          checkContent: false,
        },
        10
      );

      // Create a temporary file
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      const tmpFile = path.join(os.tmpdir(), 'test-file.txt');
      await fs.writeFile(tmpFile, 'This file is longer than 10 bytes');

      const result = await smallService.validateUpload(
        tmpFile,
        'test-file.txt',
        'text/plain',
        'abc123',
        100
      );

      await fs.unlink(tmpFile).catch(() => {});

      expect(result.valid).toBe(false);
      expect(result.sizeValid).toBe(false);
    });
  });
});
