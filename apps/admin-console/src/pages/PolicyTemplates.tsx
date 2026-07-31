import { useState, useEffect } from 'react'
import { PageHeader, DataTable, Modal } from '../components'
import { policyTemplateApi } from '../api/client'
import type { PolicyTemplate, PolicyRule } from '../api/types'

export default function PolicyTemplates() {
  const [templates, setTemplates] = useState<PolicyTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<PolicyTemplate | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    loadTemplates()
  }, [])

  const loadTemplates = async () => {
    try {
      setLoading(true)
      const data = await policyTemplateApi.list()
      setTemplates(data)
    } catch (error) {
      console.error('Failed to load policy templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (template: PolicyTemplate) => {
    if (!confirm(`Are you sure you want to delete the policy template "${template.name}"?`)) {
      return
    }
    try {
      setActionLoading(template.id)
      await policyTemplateApi.delete(template.id)
      await loadTemplates()
    } catch (error) {
      console.error('Failed to delete policy template:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getActionStyle = (action: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      allow: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e' },
      deny: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444' },
      require_approval: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308' },
    }
    const style = colors[action] || colors.require_approval
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
      render: (t: PolicyTemplate) => (
        <div>
          <div style={{ fontWeight: 500 }}>{t.name}</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>{t.description}</div>
        </div>
      ),
    },
    {
      key: 'rules',
      header: 'Rules',
      render: (t: PolicyTemplate) => (
        <span style={{ color: '#888' }}>{t.rules.length} rule(s)</span>
      ),
    },
    {
      key: 'isDefault',
      header: 'Default',
      render: (t: PolicyTemplate) => (
        t.isDefault ? (
          <span style={{
            display: 'inline-block',
            padding: '0.2rem 0.6rem',
            borderRadius: '4px',
            fontSize: '0.8rem',
            fontWeight: 500,
            backgroundColor: 'rgba(100, 108, 255, 0.1)',
            color: '#646cff',
          }}>
            Default
          </span>
        ) : (
          <span style={{ color: '#555' }}>-</span>
        )
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last Updated',
      render: (t: PolicyTemplate) => (
        <span style={{ color: '#888', fontSize: '0.9rem' }}>
          {formatDate(t.updatedAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '200px',
      render: (t: PolicyTemplate) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSelectedTemplate(t)
              setIsModalOpen(true)
            }}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
          >
            View Rules
          </button>
          {!t.isDefault && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDelete(t)
              }}
              disabled={actionLoading === t.id}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: '#ef4444' }}
            >
              {actionLoading === t.id ? '...' : 'Delete'}
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Policy Templates"
        description="Manage policy templates that control browser automation behavior"
      />

      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <DataTable
          data={templates}
          columns={columns}
          keyExtractor={(t) => t.id}
          loading={loading}
          emptyMessage="No policy templates configured"
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedTemplate(null)
        }}
        title={selectedTemplate ? `Policy Rules: ${selectedTemplate.name}` : 'Policy Template'}
        size="large"
        footer={
          <button
            onClick={() => {
              setIsModalOpen(false)
              setSelectedTemplate(null)
            }}
          >
            Close
          </button>
        }
      >
        {selectedTemplate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem' }}>Description</label>
              <p>{selectedTemplate.description}</p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '0.85rem', marginBottom: '0.75rem', display: 'block' }}>
                Rules ({selectedTemplate.rules.length})
              </label>
              <div style={{
                border: '1px solid #333',
                borderRadius: '8px',
                overflow: 'hidden'
              }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '120px' }}>Action</th>
                      <th>Resource</th>
                      <th>Conditions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTemplate.rules.map((rule: PolicyRule) => (
                      <tr key={rule.id}>
                        <td>
                          <span style={getActionStyle(rule.action)}>
                            {rule.action === 'require_approval' ? 'Require Approval' : rule.action.charAt(0).toUpperCase() + rule.action.slice(1)}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                          {rule.resource}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: '#888' }}>
                          {rule.conditions && Object.keys(rule.conditions).length > 0
                            ? Object.entries(rule.conditions).map(([k, v]) => `${k}: ${v}`).join(', ')
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
