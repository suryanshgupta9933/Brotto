import { useState, useEffect } from 'react'
import { PageHeader, StatusBadge, DataTable, Modal } from '../components'
import { organizationApi } from '../api/client'
import type { Organization } from '../api/types'

export default function Organizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    loadOrganizations()
  }, [])

  const loadOrganizations = async () => {
    try {
      setLoading(true)
      const data = await organizationApi.list()
      setOrganizations(data)
    } catch (error) {
      console.error('Failed to load organizations:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSuspend = async (org: Organization) => {
    try {
      setActionLoading(org.id)
      await organizationApi.suspend(org.id)
      await loadOrganizations()
    } catch (error) {
      console.error('Failed to suspend organization:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const handleActivate = async (org: Organization) => {
    try {
      setActionLoading(org.id)
      await organizationApi.activate(org.id)
      await loadOrganizations()
    } catch (error) {
      console.error('Failed to activate organization:', error)
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

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (org: Organization) => (
        <span style={{ fontWeight: 500 }}>{org.name}</span>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (org: Organization) => (
        <span style={{
          textTransform: 'capitalize',
          color: org.plan === 'enterprise' ? '#646cff' : org.plan === 'pro' ? '#22c55e' : '#888'
        }}>
          {org.plan}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (org: Organization) => <StatusBadge status={org.status} />,
    },
    {
      key: 'userCount',
      header: 'Users',
      render: (org: Organization) => org.userCount.toLocaleString(),
    },
    {
      key: 'sessionCount',
      header: 'Sessions',
      render: (org: Organization) => org.sessionCount.toLocaleString(),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (org: Organization) => formatDate(org.createdAt),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '200px',
      render: (org: Organization) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSelectedOrg(org)
              setIsModalOpen(true)
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
          >
            View
          </button>
          {org.status === 'active' ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleSuspend(org)
              }}
              disabled={actionLoading === org.id}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: '#ef4444' }}
            >
              {actionLoading === org.id ? 'Suspending...' : 'Suspend'}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleActivate(org)
              }}
              disabled={actionLoading === org.id}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: '#22c55e' }}
            >
              {actionLoading === org.id ? 'Activating...' : 'Activate'}
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Organizations"
        description="Manage platform organizations and their settings"
      />

      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <DataTable
          data={organizations}
          columns={columns}
          keyExtractor={(org) => org.id}
          loading={loading}
          emptyMessage="No organizations found"
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedOrg(null)
        }}
        title="Organization Details"
        footer={
          <>
            <button
              onClick={() => {
                setIsModalOpen(false)
                setSelectedOrg(null)
              }}
            >
              Close
            </button>
          </>
        }
      >
        {selectedOrg && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Organization Name</label>
              <p style={{ fontWeight: 500 }}>{selectedOrg.name}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Status</label>
              <p><StatusBadge status={selectedOrg.status} /></p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Plan</label>
              <p style={{ textTransform: 'capitalize' }}>{selectedOrg.plan}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Users</label>
              <p>{selectedOrg.userCount.toLocaleString()}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Active Sessions</label>
              <p>{selectedOrg.sessionCount.toLocaleString()}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Created</label>
              <p>{formatDate(selectedOrg.createdAt)}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
