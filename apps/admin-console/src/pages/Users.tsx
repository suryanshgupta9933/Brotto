import { useState, useEffect } from 'react'
import { PageHeader, StatusBadge, DataTable, Modal } from '../components'
import { userApi } from '../api/client'
import type { User } from '../api/types'

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')

  useEffect(() => {
    loadUsers()
  }, [filterStatus])

  const loadUsers = async () => {
    try {
      setLoading(true)
      const params: { status?: string } = {}
      if (filterStatus) params.status = filterStatus
      const data = await userApi.list(params)
      setUsers(data)
    } catch (error) {
      console.error('Failed to load users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSuspend = async (user: User) => {
    try {
      setActionLoading(user.id)
      await userApi.suspend(user.id)
      await loadUsers()
    } catch (error) {
      console.error('Failed to suspend user:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getRoleBadgeStyle = (role: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      admin: { bg: 'rgba(100, 108, 255, 0.1)', text: '#646cff' },
      operator: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308' },
      user: { bg: 'rgba(107, 114, 128, 0.1)', text: '#6b7280' },
    }
    const style = colors[role] || colors.user
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

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (user: User) => (
        <div>
          <div style={{ fontWeight: 500 }}>{user.name}</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>{user.email}</div>
        </div>
      ),
    },
    {
      key: 'organizationId',
      header: 'Organization ID',
      render: (user: User) => (
        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
          {user.organizationId.slice(0, 8)}...
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (user: User) => (
        <span style={getRoleBadgeStyle(user.role)}>{user.role}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (user: User) => <StatusBadge status={user.status} />,
    },
    {
      key: 'lastActiveAt',
      header: 'Last Active',
      render: (user: User) => (
        <span style={{ color: '#888', fontSize: '0.9rem' }}>
          {formatDate(user.lastActiveAt)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (user: User) => (
        <span style={{ color: '#888', fontSize: '0.9rem' }}>
          {formatDate(user.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '180px',
      render: (user: User) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSelectedUser(user)
              setIsModalOpen(true)
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
          >
            View
          </button>
          {user.status === 'active' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleSuspend(user)
              }}
              disabled={actionLoading === user.id}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: '#ef4444' }}
            >
              {actionLoading === user.id ? '...' : 'Suspend'}
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage platform users and their permissions"
        actions={
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: '0.5rem', minWidth: '140px' }}
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        }
      />

      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <DataTable
          data={users}
          columns={columns}
          keyExtractor={(user) => user.id}
          loading={loading}
          emptyMessage="No users found"
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedUser(null)
        }}
        title="User Details"
        footer={
          <>
            <button
              onClick={() => {
                setIsModalOpen(false)
                setSelectedUser(null)
              }}
            >
              Close
            </button>
          </>
        }
      >
        {selectedUser && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Full Name</label>
              <p style={{ fontWeight: 500 }}>{selectedUser.name}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Email</label>
              <p>{selectedUser.email}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Role</label>
              <p><span style={getRoleBadgeStyle(selectedUser.role)}>{selectedUser.role}</span></p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Status</label>
              <p><StatusBadge status={selectedUser.status} /></p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Organization ID</label>
              <p style={{ fontFamily: 'monospace' }}>{selectedUser.organizationId}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Last Active</label>
              <p>{formatDate(selectedUser.lastActiveAt)}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Created</label>
              <p>{formatDate(selectedUser.createdAt)}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
