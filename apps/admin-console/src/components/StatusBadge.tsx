type Status = 'active' | 'running' | 'healthy' | 'connected' | 'completed' | 'success'
  | 'inactive' | 'stopped' | 'degraded' | 'pending' | 'created' | 'waiting'
  | 'observing' | 'planning' | 'executing' | 'deploying'
  | 'suspended' | 'failed' | 'down' | 'terminated' | 'cancelled' | 'error'

const statusColors: Record<Status, { bg: string; text: string; border: string }> = {
  active: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: '#22c55e' },
  running: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: '#22c55e' },
  healthy: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: '#22c55e' },
  connected: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: '#22c55e' },
  completed: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: '#22c55e' },
  success: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: '#22c55e' },

  inactive: { bg: 'rgba(107, 114, 128, 0.1)', text: '#6b7280', border: '#6b7280' },
  stopped: { bg: 'rgba(107, 114, 128, 0.1)', text: '#6b7280', border: '#6b7280' },
  degraded: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
  pending: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
  created: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
  waiting: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
  observing: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
  planning: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
  executing: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },
  deploying: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: '#eab308' },

  suspended: { bg: 'rgba(249, 115, 22, 0.1)', text: '#f97316', border: '#f97316' },
  failed: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: '#ef4444' },
  down: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: '#ef4444' },
  terminated: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: '#ef4444' },
  cancelled: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: '#ef4444' },
  error: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: '#ef4444' },
}

interface StatusBadgeProps {
  status: Status
  label?: string
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const colors = statusColors[status] || statusColors.pending
  const displayLabel = label || status.charAt(0).toUpperCase() + status.slice(1)

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.25rem 0.75rem',
      borderRadius: '9999px',
      fontSize: '0.75rem',
      fontWeight: 500,
      backgroundColor: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
    }}>
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: colors.text,
        marginRight: '0.5rem',
      }} />
      {displayLabel}
    </span>
  )
}
