import { useState, useEffect } from 'react'
import { PageHeader, StatusBadge } from '../components'
import { healthApi } from '../api/client'
import type { HealthMetrics, ServiceHealth } from '../api/types'

export default function SystemHealth() {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null)
  const [services, setServices] = useState<ServiceHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [duration, setDuration] = useState<string>('1h')

  useEffect(() => {
    loadHealthData()
    const interval = setInterval(loadHealthData, 30000)
    return () => clearInterval(interval)
  }, [duration])

  const loadHealthData = async () => {
    try {
      setLoading(true)
      const [metricsData, servicesData] = await Promise.all([
        healthApi.getMetrics(),
        healthApi.getServiceHealth(),
      ])
      setMetrics(metricsData)
      setServices(servicesData)
    } catch (error) {
      console.error('Failed to load health data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  const getUtilizationColor = (value: number) => {
    if (value >= 90) return '#ef4444'
    if (value >= 70) return '#eab308'
    return '#22c55e'
  }

  const MetricCard = ({ label, value, unit, color }: { label: string; value: number | string; unit?: string; color?: string }) => (
    <div style={{
      backgroundColor: '#1a1a1a',
      borderRadius: '8px',
      padding: '1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    }}>
      <span style={{ fontSize: '0.85rem', color: '#888' }}>{label}</span>
      <span style={{ fontSize: '2rem', fontWeight: 600, color: color || 'inherit' }}>
        {value}
        {unit && <span style={{ fontSize: '1rem', marginLeft: '0.25rem', color: '#888' }}>{unit}</span>}
      </span>
    </div>
  )

  const UtilizationBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <span style={{ width: '100px', color: '#888', fontSize: '0.9rem' }}>{label}</span>
      <div style={{ flex: 1, height: '8px', backgroundColor: '#333', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          width: `${value}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: '4px',
          transition: 'width 0.3s ease',
        }} />
      </div>
      <span style={{ width: '50px', textAlign: 'right', fontSize: '0.9rem' }}>{value}%</span>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="System Health"
        description="Monitor platform health metrics and service status"
        actions={
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            style={{ padding: '0.5rem', minWidth: '140px' }}
          >
            <option value="15m">Last 15 minutes</option>
            <option value="1h">Last hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
        }
      />

      {loading && !metrics ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#888' }}>
          Loading health metrics...
        </div>
      ) : metrics && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
            <MetricCard
              label="Active Sessions"
              value={metrics.activeSessions}
            />
            <MetricCard
              label="Queued Sessions"
              value={metrics.queuedSessions}
              color={metrics.queuedSessions > 10 ? '#eab308' : undefined}
            />
            <MetricCard
              label="Failed Requests"
              value={metrics.failedRequests}
              color={metrics.failedRequests > 5 ? '#ef4444' : undefined}
            />
            <MetricCard
              label="Avg Latency"
              value={metrics.averageLatencyMs}
              unit="ms"
              color={metrics.averageLatencyMs > 1000 ? '#ef4444' : metrics.averageLatencyMs > 500 ? '#eab308' : '#22c55e'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
            <div style={{
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              padding: '1.5rem',
            }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Resource Utilization</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <UtilizationBar
                  label="CPU"
                  value={metrics.cpuUsage}
                  color={getUtilizationColor(metrics.cpuUsage)}
                />
                <UtilizationBar
                  label="Memory"
                  value={metrics.memoryUsage}
                  color={getUtilizationColor(metrics.memoryUsage)}
                />
                <UtilizationBar
                  label="GPU"
                  value={metrics.gpuUsage}
                  color={getUtilizationColor(metrics.gpuUsage)}
                />
              </div>
            </div>

            <div style={{
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              padding: '1.5rem',
            }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Request Metrics</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.85rem', color: '#888' }}>Total Requests</span>
                  <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>{metrics.totalRequests.toLocaleString()}</p>
                </div>
                <div>
                  <span style={{ fontSize: '0.85rem', color: '#888' }}>Failed</span>
                  <p style={{ fontSize: '1.5rem', fontWeight: 600, color: '#ef4444' }}>{metrics.failedRequests.toLocaleString()}</p>
                </div>
                <div>
                  <span style={{ fontSize: '0.85rem', color: '#888' }}>Success Rate</span>
                  <p style={{ fontSize: '1.5rem', fontWeight: 600, color: '#22c55e' }}>
                    {metrics.totalRequests > 0
                      ? ((1 - metrics.failedRequests / metrics.totalRequests) * 100).toFixed(1)
                      : 100}%
                  </p>
                </div>
                <div>
                  <span style={{ fontSize: '0.85rem', color: '#888' }}>Avg Latency</span>
                  <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>{metrics.averageLatencyMs}ms</p>
                </div>
              </div>
            </div>
          </div>

          <div style={{
            backgroundColor: '#1a1a1a',
            borderRadius: '8px',
            padding: '1.5rem',
          }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Service Status</h3>
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Uptime</th>
                  <th>Last Check</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.name}>
                    <td style={{ fontWeight: 500 }}>{service.name}</td>
                    <td><StatusBadge status={service.status} /></td>
                    <td style={{ color: '#888' }}>{formatUptime(service.uptime)}</td>
                    <td style={{ color: '#888' }}>
                      {new Date(service.lastCheck).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
