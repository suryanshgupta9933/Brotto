import { useState, useEffect, useRef } from 'react'
import { PageHeader } from '../components'
import { auditLogApi } from '../api/client'
import type { AuditLog } from '../api/types'

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [eventType, setEventType] = useState<string>('')
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const limit = 50
  const loaderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadLogs(true)
  }, [startDate, endDate, eventType])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadLogs(false)
        }
      },
      { threshold: 0.1 }
    )

    if (loaderRef.current) {
      observer.observe(loaderRef.current)
    }

    return () => observer.disconnect()
  }, [hasMore, loading])

  const loadLogs = async (reset: boolean) => {
    try {
      setLoading(true)
      const currentOffset = reset ? 0 : offset
      const params: Record<string, string | number> = {
        limit,
        offset: currentOffset,
      }
      if (startDate) params.startDate = startDate
      if (endDate) params.endDate = endDate
      if (eventType) params.eventType = eventType

      const data = await auditLogApi.list(params)
      if (reset) {
        setLogs(data)
        setOffset(limit)
      } else {
        setLogs((prev) => [...prev, ...data])
        setOffset((prev) => prev + limit)
      }
      setHasMore(data.length === limit)
    } catch (error) {
      console.error('Failed to load audit logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = (format: 'json' | 'csv') => {
    const url = auditLogApi.export({
      startDate: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: endDate || new Date().toISOString().split('T')[0],
      format,
    })
    window.open(url, '_blank')
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const getResultStyle = (result: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      success: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e' },
      failure: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444' },
      pending: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308' },
    }
    const style = colors[result] || colors.pending
    return {
      display: 'inline-block',
      padding: '0.2rem 0.6rem',
      borderRadius: '4px',
      fontSize: '0.8rem',
      fontWeight: 500,
      backgroundColor: style.bg,
      color: style.text,
      textTransform: 'capitalize',
    }
  }

  const eventTypes = [
    'session.created',
    'session.started',
    'session.terminated',
    'session.completed',
    'session.failed',
    'user.login',
    'user.logout',
    'user.created',
    'user.updated',
    'user.suspended',
    'org.created',
    'org.updated',
    'org.suspended',
    'policy.violation',
    'approval.requested',
    'approval.granted',
    'approval.denied',
  ]

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="View and export audit trail for platform activities"
        actions={
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => handleExport('csv')}
              style={{ padding: '0.5rem 1rem' }}
            >
              Export CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              style={{ padding: '0.5rem 1rem', backgroundColor: '#1a1a1a' }}
            >
              Export JSON
            </button>
          </div>
        }
      />

      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        padding: '1rem',
        marginBottom: '1.5rem',
        display: 'flex',
        gap: '1rem',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
      }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#888' }}>
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '0.5rem', minWidth: '160px' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#888' }}>
            End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '0.5rem', minWidth: '160px' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#888' }}>
            Event Type
          </label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            style={{ padding: '0.5rem', minWidth: '180px' }}
          >
            <option value="">All Events</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => loadLogs(true)}
          disabled={loading}
          style={{ padding: '0.5rem 1rem' }}
        >
          Search
        </button>
      </div>

      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        {logs.length === 0 && !loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
            No audit logs found matching your criteria
          </div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '160px' }}>Timestamp</th>
                  <th style={{ width: '180px' }}>Event</th>
                  <th>Resource</th>
                  <th style={{ width: '80px' }}>Result</th>
                  <th style={{ width: '100px' }}>User ID</th>
                  <th style={{ width: '100px' }}>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: '0.85rem', color: '#888', fontFamily: 'monospace' }}>
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td style={{ fontSize: '0.9rem' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.2rem 0.5rem',
                        backgroundColor: 'rgba(100, 108, 255, 0.1)',
                        color: '#646cff',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                      }}>
                        {log.eventType}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.9rem' }}>
                      <div style={{ fontWeight: 500 }}>{log.action}</div>
                      <div style={{ fontSize: '0.8rem', color: '#888', fontFamily: 'monospace' }}>
                        {log.resource}
                      </div>
                    </td>
                    <td>
                      <span style={getResultStyle(log.result)}>{log.result}</span>
                    </td>
                    <td style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: '#888' }}>
                      {log.userId ? `${log.userId.slice(0, 8)}...` : '-'}
                    </td>
                    <td style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: '#888' }}>
                      {log.ipAddress}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div ref={loaderRef} style={{ padding: '1rem', textAlign: 'center', color: '#888' }}>
                {loading ? 'Loading more...' : 'Scroll to load more'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
