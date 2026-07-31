import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionUpdates, usePendingApprovals, usePolling } from '../hooks';

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock EventSource
class MockEventSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  static OPEN = 1;

  constructor(_url: string) {
    // Do nothing
  }
}

vi.stubGlobal('EventSource', MockEventSource);

describe('Hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('useSessionUpdates', () => {
    it('returns update and error state', () => {
      const { result } = renderHook(() => useSessionUpdates(null));
      expect(result.current.update).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('usePendingApprovals', () => {
    it('fetches approvals on mount', async () => {
      const mockApprovals = [
        {
          id: '1',
          sessionId: 's1',
          taskId: 't1',
          taskName: 'Test Task',
          proposedAction: 'Click Submit',
          targetWebsite: 'example.com',
          fieldNames: [],
          dataToSubmit: {},
          expectedConsequence: 'Form submitted',
          createdAt: '',
          status: 'pending' as const,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApprovals),
      });

      const { result } = renderHook(() => usePendingApprovals());

      // Wait for initial fetch
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(result.current.loading).toBe(false);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('usePolling', () => {
    it('polls at specified interval', async () => {
      const fetchFn = vi.fn().mockResolvedValue('data');
      const { result } = renderHook(() => usePolling(fetchFn, 1000, true));

      expect(result.current.loading).toBe(true);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(result.current.loading).toBe(false);
      expect(fetchFn).toHaveBeenCalled();
    });

    it('does not poll when disabled', () => {
      const fetchFn = vi.fn();
      renderHook(() => usePolling(fetchFn, 1000, false));

      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
