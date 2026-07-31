import { useState, useEffect } from 'react'
import { PageHeader, StatusBadge, DataTable, Modal } from '../components'
import { modelDeploymentApi } from '../api/client'
import type { ModelDeployment } from '../api/types'

export default function ModelDeployment() {
  const [deployments, setDeployments] = useState<ModelDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDeployment, setSelectedDeployment] = useState<ModelDeployment | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [scaleReplicas, setScaleReplicas] = useState<number>(1)

  useEffect(() => {
    loadDeployments()
  }, [])

  const loadDeployments = async () => {
    try {
      setLoading(true)
      const data = await modelDeploymentApi.list()
      setDeployments(data)
    } catch (error) {
      console.error('Failed to load deployments:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleStart = async (deployment: ModelDeployment) => {
    try {
      setActionLoading(deployment.id)
      await modelDeploymentApi.start(deployment.id)
      await loadDeployments()
    } catch (error) {
      console.error('Failed to start deployment:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const handleStop = async (deployment: ModelDeployment) => {
    try {
      setActionLoading(deployment.id)
      await modelDeploymentApi.stop(deployment.id)
      await loadDeployments()
    } catch (error) {
      console.error('Failed to stop deployment:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const handleScale = async (deployment: ModelDeployment) => {
    try {
      setActionLoading(deployment.id)
      await modelDeploymentApi.scale(deployment.id, scaleReplicas)
      setIsModalOpen(false)
      setSelectedDeployment(null)
      await loadDeployments()
    } catch (error) {
      console.error('Failed to scale deployment:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const getModelBadgeStyle = (model: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      'fara-4b': { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e' },
      'fara-9b': { bg: 'rgba(100, 108, 255, 0.1)', text: '#646cff' },
      'fara-27b': { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308' },
    }
    const style = colors[model] || colors['fara-9b']
    return {
      display: 'inline-block',
      padding: '0.2rem 0.6rem',
      borderRadius: '4px',
      fontSize: '0.8rem',
      fontWeight: 500,
      backgroundColor: style.bg,
      color: style.text,
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (d: ModelDeployment) => (
        <span style={{ fontWeight: 500 }}>{d.name}</span>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (d: ModelDeployment) => (
        <span style={getModelBadgeStyle(d.model)}>{d.model.toUpperCase()}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d: ModelDeployment) => <StatusBadge status={d.status} />,
    },
    {
      key: 'replicas',
      header: 'Replicas',
      render: (d: ModelDeployment) => d.replicas,
    },
    {
      key: 'gpuType',
      header: 'GPU Type',
      render: (d: ModelDeployment) => (
        <span style={{ color: '#888' }}>{d.gpuType}</span>
      ),
    },
    {
      key: 'endpoint',
      header: 'Endpoint',
      render: (d: ModelDeployment) => (
        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#888' }}>
          {d.endpoint}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (d: ModelDeployment) => formatDate(d.createdAt),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '280px',
      render: (d: ModelDeployment) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSelectedDeployment(d)
              setScaleReplicas(d.replicas)
              setIsModalOpen(true)
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
          >
            Scale
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSelectedDeployment(d)
              setIsModalOpen(true)
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
          >
            Details
          </button>
          {d.status === 'running' ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleStop(d)
              }}
              disabled={actionLoading === d.id}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: '#ef4444' }}
            >
              {actionLoading === d.id ? 'Stopping...' : 'Stop'}
            </button>
          ) : d.status === 'stopped' ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleStart(d)
              }}
              disabled={actionLoading === d.id}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: '#22c55e' }}
            >
              {actionLoading === d.id ? 'Starting...' : 'Start'}
            </button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Model Deployment"
        description="Configure and manage Fara model inference deployments"
      />

      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <DataTable
          data={deployments}
          columns={columns}
          keyExtractor={(d) => d.id}
          loading={loading}
          emptyMessage="No model deployments configured"
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedDeployment(null)
        }}
        title={selectedDeployment ? `Scale ${selectedDeployment.name}` : 'Deployment Details'}
        size="small"
        footer={
          selectedDeployment ? (
            <>
              <button
                onClick={() => {
                  setIsModalOpen(false)
                  setSelectedDeployment(null)
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleScale(selectedDeployment)}
                disabled={actionLoading === selectedDeployment.id}
                style={{ backgroundColor: '#646cff' }}
              >
                {actionLoading === selectedDeployment.id ? 'Scaling...' : 'Scale'}
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setIsModalOpen(false)
                setSelectedDeployment(null)
              }}
            >
              Close
            </button>
          )
        }
      >
        {selectedDeployment && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {selectedDeployment.status === 'running' || selectedDeployment.status === 'stopped' ? (
              <>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                    Number of Replicas
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={scaleReplicas}
                    onChange={(e) => setScaleReplicas(parseInt(e.target.value) || 1)}
                    style={{ width: '100%' }}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Deployment Name</label>
                  <p style={{ fontWeight: 500 }}>{selectedDeployment.name}</p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Model</label>
                  <p><span style={getModelBadgeStyle(selectedDeployment.model)}>{selectedDeployment.model.toUpperCase()}</span></p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Status</label>
                  <p><StatusBadge status={selectedDeployment.status} /></p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Replicas</label>
                  <p>{selectedDeployment.replicas}</p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>GPU Type</label>
                  <p>{selectedDeployment.gpuType}</p>
                </div>
                <div>
                  <label style={{ color: '#888', fontSize: '0.85rem' }}>Endpoint</label>
                  <p style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{selectedDeployment.endpoint}</p>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
