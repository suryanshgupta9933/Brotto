import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionUpdate, ApprovalRequest } from '../types';
import { sessionApi, approvalApi } from '../api/client';

export function useSessionUpdates(sessionId: string | null) {
  const [update, setUpdate] = useState<SessionUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // Use SSE for session updates
    const eventSource = new EventSource(`/api/v1/sessions/${sessionId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SessionUpdate;
        setUpdate(data);
      } catch {
        setError('Failed to parse session update');
      }
    };

    eventSource.onerror = () => {
      setError('Connection lost');
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await sessionApi.getUpdates(sessionId);
      setUpdate(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch update');
    }
  }, [sessionId]);

  return { update, error, refresh };
}

export function usePendingApprovals() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchApprovals = useCallback(async () => {
    try {
      const data = await approvalApi.list('pending');
      setApprovals(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();

    // Use SSE for real-time approval updates
    const eventSource = new EventSource('/api/v1/approvals/stream');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: 'new' | 'resolved'; approval: ApprovalRequest };
        if (data.type === 'new') {
          setApprovals((prev) => [...prev, data.approval]);
        } else {
          setApprovals((prev) => prev.filter((a) => a.id !== data.approval.id));
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      eventSource.close();
    };
  }, [fetchApprovals]);

  return { approvals, loading, error, refetch: fetchApprovals };
}

export function usePolling<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number = 5000,
  enabled: boolean = true
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    const fetch = async () => {
      try {
        const result = await fetchFn();
        if (mounted) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetch();
    const interval = setInterval(fetch, intervalMs);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchFn, intervalMs, enabled]);

  return { data, loading, error };
}
