import { describe, it, expect } from 'vitest';
import {
  FaraSDKError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  NetworkError,
  SessionNotFoundError,
  TaskNotFoundError,
  ApprovalNotFoundError,
  WebSocketError,
  isSDKError,
  isAuthenticationError,
  isNetworkError,
} from '../errors.js';

describe('errors', () => {
  describe('FaraSDKError', () => {
    it('should create error with default values', () => {
      const error = new FaraSDKError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('SDK_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.details).toBeUndefined();
    });

    it('should create error with custom values', () => {
      const error = new FaraSDKError('Test error', 'CUSTOM_CODE', 400, { key: 'value' });
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ key: 'value' });
    });

    it('should be an SDK error', () => {
      const error = new FaraSDKError('Test error');
      expect(isSDKError(error)).toBe(true);
    });
  });

  describe('AuthenticationError', () => {
    it('should create error with default message', () => {
      const error = new AuthenticationError();
      expect(error.message).toBe('Authentication failed');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
    });

    it('should create error with custom message', () => {
      const error = new AuthenticationError('Token invalid');
      expect(error.message).toBe('Token invalid');
    });

    it('should be an authentication error', () => {
      const error = new AuthenticationError();
      expect(isAuthenticationError(error)).toBe(true);
    });
  });

  describe('AuthorizationError', () => {
    it('should create error with default message', () => {
      const error = new AuthorizationError();
      expect(error.message).toBe('Access denied');
      expect(error.code).toBe('AUTHORIZATION_ERROR');
      expect(error.statusCode).toBe(403);
    });

    it('should create error with custom message', () => {
      const error = new AuthorizationError('Insufficient permissions');
      expect(error.message).toBe('Insufficient permissions');
    });
  });

  describe('NotFoundError', () => {
    it('should create error with resource and id', () => {
      const error = new NotFoundError('Task', '123');
      expect(error.message).toBe("Task with id '123' not found");
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });

    it('should create error with resource only', () => {
      const error = new NotFoundError('Resource');
      expect(error.message).toBe('Resource not found');
    });
  });

  describe('ValidationError', () => {
    it('should create error with validation errors', () => {
      const validationErrors = [{ field: 'goal', message: 'required' }];
      const error = new ValidationError('Validation failed', validationErrors);
      expect(error.message).toBe('Validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.validationErrors).toEqual(validationErrors);
    });
  });

  describe('RateLimitError', () => {
    it('should create error with retry after', () => {
      const error = new RateLimitError('Rate limit exceeded', 60);
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.code).toBe('RATE_LIMIT_ERROR');
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe('NetworkError', () => {
    it('should create error with default message', () => {
      const error = new NetworkError();
      expect(error.message).toBe('Network error occurred');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.statusCode).toBe(0);
    });

    it('should be a network error', () => {
      const error = new NetworkError();
      expect(isNetworkError(error)).toBe(true);
    });
  });

  describe('SessionNotFoundError', () => {
    it('should create error with session id', () => {
      const error = new SessionNotFoundError('session-123');
      expect(error.message).toBe("Session 'session-123' not found or expired");
      expect(error.code).toBe('SESSION_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('TaskNotFoundError', () => {
    it('should create error with task id', () => {
      const error = new TaskNotFoundError('task-456');
      expect(error.message).toBe("Task 'task-456' not found");
      expect(error.code).toBe('TASK_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('ApprovalNotFoundError', () => {
    it('should create error with approval id', () => {
      const error = new ApprovalNotFoundError('approval-789');
      expect(error.message).toBe("Approval request 'approval-789' not found");
      expect(error.code).toBe('APPROVAL_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('WebSocketError', () => {
    it('should create error with message', () => {
      const error = new WebSocketError('Connection failed');
      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('WEBSOCKET_ERROR');
      expect(error.statusCode).toBe(0);
    });
  });
});
