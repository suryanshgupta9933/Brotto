/**
 * Unit tests for action result types.
 */

import {
  ActionErrorCode,
  createActionSuccess,
  createActionFailure,
} from '../results';
import { ActionType } from '../actions';

describe('ActionErrorCode', () => {
  it('should have correct error codes', () => {
    expect(ActionErrorCode.TIMEOUT).toBe('timeout');
    expect(ActionErrorCode.ELEMENT_NOT_FOUND).toBe('element_not_found');
    expect(ActionErrorCode.INVALID_COORDINATES).toBe('invalid_coordinates');
    expect(ActionErrorCode.INVALID_URL).toBe('invalid_url');
    expect(ActionErrorCode.NAVIGATION_FAILED).toBe('navigation_failed');
    expect(ActionErrorCode.PERMISSION_DENIED).toBe('permission_denied');
    expect(ActionErrorCode.CANCELLED).toBe('cancelled');
    expect(ActionErrorCode.NOT_SUPPORTED).toBe('not_supported');
    expect(ActionErrorCode.UNKNOWN).toBe('unknown');
  });
});

describe('createActionSuccess', () => {
  it('should create success result with type', () => {
    const result = createActionSuccess(ActionType.LEFT_CLICK);
    expect(result.actionType).toBe(ActionType.LEFT_CLICK);
    expect(result.success).toBe(true);
    expect(result.timestamp).toBeDefined();
  });

  it('should create success result with data', () => {
    const result = createActionSuccess(ActionType.SCREENSHOT, {
      screenshot: 'base64data',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ screenshot: 'base64data' });
  });

  it('should create success result with page title', () => {
    const result = createActionSuccess(ActionType.VISIT_URL, {
      pageTitle: 'Example Domain',
      url: 'https://example.com',
    });
    expect(result.data).toEqual({
      pageTitle: 'Example Domain',
      url: 'https://example.com',
    });
  });
});

describe('createActionFailure', () => {
  it('should create failure result with type and error', () => {
    const result = createActionFailure(
      ActionType.LEFT_CLICK,
      ActionErrorCode.ELEMENT_NOT_FOUND,
      'Element not found at coordinates (100, 200)'
    );
    expect(result.actionType).toBe(ActionType.LEFT_CLICK);
    expect(result.success).toBe(false);
    expect(result.error.code).toBe(ActionErrorCode.ELEMENT_NOT_FOUND);
    expect(result.error.message).toBe('Element not found at coordinates (100, 200)');
  });

  it('should create failure result with details', () => {
    const result = createActionFailure(
      ActionType.VISIT_URL,
      ActionErrorCode.NAVIGATION_FAILED,
      'Navigation timed out',
      { timeout: 30000, url: 'https://example.com' }
    );
    expect(result.success).toBe(false);
    expect(result.error.details).toEqual({
      timeout: 30000,
      url: 'https://example.com',
    });
  });

  it('should create timeout error correctly', () => {
    const result = createActionFailure(
      ActionType.WAIT,
      ActionErrorCode.TIMEOUT,
      'Wait action timed out'
    );
    expect(result.error.code).toBe(ActionErrorCode.TIMEOUT);
  });

  it('should create invalid coordinates error correctly', () => {
    const result = createActionFailure(
      ActionType.LEFT_CLICK,
      ActionErrorCode.INVALID_COORDINATES,
      'Coordinates out of bounds'
    );
    expect(result.error.code).toBe(ActionErrorCode.INVALID_COORDINATES);
  });

  it('should create invalid URL error correctly', () => {
    const result = createActionFailure(
      ActionType.VISIT_URL,
      ActionErrorCode.INVALID_URL,
      'Invalid URL format'
    );
    expect(result.error.code).toBe(ActionErrorCode.INVALID_URL);
  });

  it('should create permission denied error correctly', () => {
    const result = createActionFailure(
      ActionType.SCREENSHOT,
      ActionErrorCode.PERMISSION_DENIED,
      'Screenshot permission denied'
    );
    expect(result.error.code).toBe(ActionErrorCode.PERMISSION_DENIED);
  });
});
