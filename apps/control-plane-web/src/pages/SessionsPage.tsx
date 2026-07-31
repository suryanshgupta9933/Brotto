import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Session, SessionState } from '../types';
import { sessionApi } from '../api/client';
import { useSessionUpdates } from '../hooks';
import { Card, Button, Badge, Spinner, EmptyState, ErrorMessage } from '../components/Layout';

export function SessionsPage() {
  const [searchParams] = useSearchParams();
  const taskIdFilter = searchParams.get('taskId');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const fetchSessions = async () => {
    try {
      const data = await sessionApi.list(taskIdFilter || undefined);
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [taskIdFilter]);

  const handlePause = async (sessionId: string) => {
    try {
      await sessionApi.pause(sessionId);
      fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause session');
    }
  };

  const handleResume = async (sessionId: string) => {
    try {
      await sessionApi.resume(sessionId);
      fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume session');
    }
  };

  const handleTerminate = async (sessionId: string) => {
    if (!confirm('Are you sure you want to terminate this session?')) return;
    try {
      await sessionApi.terminate(sessionId);
      fetchSessions();
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to terminate session');
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} onRetry={fetchSessions} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        {taskIdFilter && (
          <p className="text-sm text-gray-500">Filtered by task: {taskIdFilter}</p>
        )}
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Sessions will appear here when tasks are running"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            {sessions.map((session) => (
              <Card
                key={session.id}
                onClick={() => setSelectedSessionId(session.id)}
                className={selectedSessionId === session.id ? 'ring-2 ring-blue-500' : ''}
              >
                <SessionCard session={session} />
              </Card>
            ))}
          </div>

          {selectedSessionId && (
            <div className="lg:col-span-1">
              <SessionDetail
                sessionId={selectedSessionId}
                onPause={handlePause}
                onResume={handleResume}
                onTerminate={handleTerminate}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  return (
    <div className="p-4">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <h3 className="text-lg font-medium text-gray-900">{session.taskName}</h3>
          <p className="text-sm text-gray-500">
            {session.currentDomain || 'No domain'}
          </p>
        </div>
        <SessionStateBadge state={session.state} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Started {new Date(session.startedAt).toLocaleString()}
        </p>
        {session.deviceName && (
          <p className="text-xs text-gray-400">{session.deviceName}</p>
        )}
      </div>
    </div>
  );
}

function SessionDetail({
  sessionId,
  onPause,
  onResume,
  onTerminate,
}: {
  sessionId: string;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onTerminate: (id: string) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const { update } = useSessionUpdates(sessionId);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const data = await sessionApi.get(sessionId);
        setSession(data);
      } catch {
        // Ignore errors
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, [sessionId]);

  // Update session from live updates
  useEffect(() => {
    if (update && update.sessionId === sessionId) {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              state: update.state,
              currentUrl: update.currentUrl,
              currentDomain: update.currentDomain,
              screenshotUrl: update.screenshotUrl,
            }
          : null
      );
    }
  }, [update, sessionId]);

  if (loading) return <Spinner />;
  if (!session) return <p className="text-gray-500">Session not found</p>;

  const isRunning =
    session.state === 'EXECUTING' ||
    session.state === 'OBSERVING' ||
    session.state === 'PLANNING';
  const isPaused = session.state === 'WAITING_FOR_APPROVAL';

  return (
    <Card>
      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">{session.taskName}</h3>
          <SessionStateBadge state={session.state} />
        </div>

        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-gray-500">Current URL</p>
            <p className="text-sm text-gray-900 truncate">{session.currentUrl || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Current Domain</p>
            <p className="text-sm text-gray-900">{session.currentDomain || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Device</p>
            <p className="text-sm text-gray-900">{session.deviceName || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Started</p>
            <p className="text-sm text-gray-900">
              {new Date(session.startedAt).toLocaleString()}
            </p>
          </div>
        </div>

        {session.screenshotUrl && (
          <div>
            <p className="text-sm font-medium text-gray-500 mb-2">Screenshot Preview</p>
            <img
              src={session.screenshotUrl}
              alt="Session screenshot"
              className="w-full rounded-lg border border-gray-200"
            />
          </div>
        )}

        <div className="flex space-x-3">
          {isRunning && (
            <Button variant="secondary" onClick={() => onPause(sessionId)}>
              Pause
            </Button>
          )}
          {isPaused && (
            <Button variant="primary" onClick={() => onResume(sessionId)}>
              Resume
            </Button>
          )}
          <Button variant="danger" onClick={() => onTerminate(sessionId)}>
            Terminate
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SessionStateBadge({ state }: { state: SessionState }) {
  const stateConfig: Record<
    SessionState,
    { variant: 'default' | 'success' | 'warning' | 'danger' | 'info'; label: string }
  > = {
    CREATED: { variant: 'default', label: 'Created' },
    WAITING_FOR_CLIENT: { variant: 'warning', label: 'Waiting for Client' },
    CONNECTED: { variant: 'info', label: 'Connected' },
    OBSERVING: { variant: 'info', label: 'Observing' },
    PLANNING: { variant: 'info', label: 'Planning' },
    POLICY_CHECK: { variant: 'info', label: 'Policy Check' },
    WAITING_FOR_APPROVAL: { variant: 'warning', label: 'Waiting for Approval' },
    EXECUTING: { variant: 'success', label: 'Executing' },
    VERIFYING: { variant: 'info', label: 'Verifying' },
    COMPLETED: { variant: 'success', label: 'Completed' },
    FAILED: { variant: 'danger', label: 'Failed' },
    CANCELLED: { variant: 'default', label: 'Cancelled' },
  };

  const config = stateConfig[state] || { variant: 'default' as const, label: state };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
