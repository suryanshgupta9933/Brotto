import { useState, useEffect } from 'react'
import { PageHeader, StatusBadge, DataTable, Modal } from '../components'
import { sessionApi } from '../api/client'
import type { Session } from '../api/types'

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [terminationReason, setTerminationReason] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')

  useEffect(() => {
    loadSessions()
  }, [filterStatus])

  const loadSessions = async () => {
    try {
      setLoading(true)
      const params: { status?: string } = {}
      if (filterStatus) params.status = filterStatus
      const data = await sessionApi.list(params)
      setSessions(data)
    } catch (error) {
      console.error('Failed to load sessions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTerminate = async () => {
    if (!selectedSession || !terminationReason.trim()) return
    try {
      setActionLoading(selectedSession.id)
      await sessionApi.terminate(selectedSession.id, terminationReason)
      setIsModalOpen(false)
      setSelectedSession(null)
      setTerminationReason('')
      await loadSessions()
    } catch (error) {
      console.error('Failed to terminate session:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const getSessionDuration = (start: string, end: string | null) => {
    const startTime = new Date(start).getTime()
    const endTime = end ? new Date(end).getTime() : Date.now()
    const durationMs = endTime - startTime
    const minutes = Math.floor(durationMs / 60000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  const columns = [
    {
      key: 'id',
      header: 'Session ID',
      render: (s: Session) => (
        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
          {s.id.slice(0, 8)}...
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s: Session) => <StatusBadge status={s.status} />,
    },
    {
      key: 'currentDomain',
      header: 'Current Domain',
      render: (s: Session) => (
        <span style={{ color: '#888', fontSize: '0.9rem' }}>
          {s.currentDomain || '-'}
        </span>
      ),
    },
    {
      key: 'agentSteps',
      header: 'Steps',
      render: (s: Session) => s.agentSteps,
    },
    {
      key: 'screenshotsCount',
      header: 'Screenshots',
      render: (s: Session) => s.screenshotsCount,
    },
    {
      key: 'startedAt',
      header: 'Duration',
      render: (s: Session) => (
        <span style={{ color: '#888', fontSize: '0.9rem' }}>
          {getSessionDuration(s.startedAt, s.lastActivityAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '200px',
      render: (s: Session) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSelectedSession(s)
              setIsModalOpen(true)
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
          >
            Details
          </button>
          {!['completed', 'failed', 'cancelled', 'terminated'].includes(s.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setSelectedSession(s)
                setTerminationReason('')
                setIsModalOpen(true)
              }}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: '#ef4444' }}
            >
              Terminate
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Sessions"
        description="Inspect active sessions and terminate them if needed"
        actions={
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: '0.5rem', minWidth: '140px' }}
            >
              <option value="">All Statuses</option>
              <option value="created">Created</option>
              <option value="waiting">Waiting</option>
              <option value="connected">Connected</option>
              <option value="observing">Observing</option>
              <option value="planning">Planning</option>
              <option value="executing">Executing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="terminated">Terminated</option>
            </select>
            <button
              onClick={loadSessions}
              disabled={loading}
              style={{ padding: '0.5rem 1rem' }}
            >
              Refresh
            </button>
          </div>
        }
      />

      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <DataTable
          data={sessions}
          columns={columns}
          keyExtractor={(s) => s.id}
          loading={loading}
          emptyMessage="No sessions found"
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedSession(null)
          setTerminationReason('')
        }}
        title={terminationReason !== '' || actionLoading ? 'Terminate Session' : 'Session Details'}
        size="small"
        footer={
          terminationReason !== '' || actionLoading ? (
            <>
              <button
                onClick={() => {
                  setIsModalOpen(false)
                  setSelectedSession(null)
                  setTerminationReason('')
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleTerminate}
                disabled={!terminationReason.trim() || !!actionLoading}
                style={{ backgroundColor: '#ef4444' }}
              >
                {actionLoading ? 'Terminating...' : 'Terminate Session'}
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setIsModalOpen(false)
                setSelectedSession(null)
              }}
            >
              Close
            </button>
          )
        }
      >
        {selectedSession && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {terminationReason === '' && !actionLoading ? (
              <>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Session ID</label>
                  <p style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{selectedSession.id}</p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Status</label>
                  <p><StatusBadge status={selectedSession.status} /></p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Current URL</label>
                  <p style={{ fontSize: '0.9rem', wordBreak: 'break-all' }}>
                    {selectedSession.currentUrl || '-'}
                  </p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Agent Steps</label>
                  <p>{selectedSession.agentSteps}</p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Screenshots Captured</label>
                  <p>{selectedSession.screenshotsCount}</p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Started</label>
                  <p>{new Date(selectedSession.startedAt).toLocaleString()}</p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Last Activity</label>
                  <p>{new Date(selectedSession.lastActivityAt).toLocaleString()}</p>
                </div>
                {selectedSession.terminationReason && (
                  <div>
                    <label style={{ color: '#888', fontSize: '0.85rem' }}>Termination Reason</label>
                    <p style={{ color: '#ef4444' }}>{selectedSession.terminationReason}</p>
                  </div>
                )}
                {!['completed', 'failed', 'cancelled', 'terminated'].includes(selectedSession.status) && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <label style={{ color: '#888', fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                      Termination Reason (required)
                    </label>
                    <textarea
                      value={terminationReason}
                      onChange={(e) => setTerminationReason(e.target.value)}
                      placeholder="Enter reason for termination..."
                      rows={3}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </div>
                )}
              </>
            ) : (
              <div>
                <p style={{ marginBottom: '1rem' }}>
                  Are you sure you want to terminate this session?
                </p>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                    Termination Reason (required)
                  </label>
                  <textarea
                    value={terminationReason}
                    onChange={(e) => setTerminationReason(e.target.value)}
                    placeholder="Enter reason for termination..."
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                    autoFocus
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
