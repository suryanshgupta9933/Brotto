import React, { useState, useEffect } from 'react';
import type { Policy, DomainAllowlist } from '../types';
import { policyApi, domainApi } from '../api/client';
import { Card, Button, Input, Textarea, Badge, Spinner, EmptyState, ErrorMessage } from '../components/Layout';

export function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [domains, setDomains] = useState<DomainAllowlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'policies' | 'domains'>('policies');
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [showDomainModal, setShowDomainModal] = useState(false);

  const fetchData = async () => {
    try {
      const [policiesData, domainsData] = await Promise.all([
        policyApi.list(),
        domainApi.list(),
      ]);
      setPolicies(policiesData);
      setDomains(domainsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleTogglePolicy = async (policy: Policy) => {
    try {
      await policyApi.update(policy.id, { enabled: !policy.enabled });
      setPolicies((prev) =>
        prev.map((p) =>
          p.id === policy.id ? { ...p, enabled: !p.enabled } : p
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update policy');
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    if (!confirm('Are you sure you want to delete this policy?')) return;
    try {
      await policyApi.delete(policyId);
      setPolicies((prev) => prev.filter((p) => p.id !== policyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete policy');
    }
  };

  const handleCreatePolicy = async (data: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const policy = await policyApi.create(data);
      setPolicies((prev) => [...prev, policy]);
      setShowPolicyModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create policy');
    }
  };

  const handleToggleDomain = async (domain: DomainAllowlist) => {
    try {
      const newAction = domain.action === 'allow' ? 'block' : domain.action === 'block' ? 'require_approval' : 'allow';
      await domainApi.update(domain.id, { action: newAction });
      setDomains((prev) =>
        prev.map((d) =>
          d.id === domain.id ? { ...d, action: newAction } : d
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update domain');
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    if (!confirm('Are you sure you want to delete this domain rule?')) return;
    try {
      await domainApi.delete(domainId);
      setDomains((prev) => prev.filter((d) => d.id !== domainId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete domain');
    }
  };

  const handleCreateDomain = async (data: Omit<DomainAllowlist, 'id' | 'createdAt'>) => {
    try {
      const domain = await domainApi.create(data);
      setDomains((prev) => [...prev, domain]);
      setShowDomainModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create domain rule');
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} onRetry={fetchData} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Policies</h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('policies')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'policies'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Policies ({policies.length})
          </button>
          <button
            onClick={() => setActiveTab('domains')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'domains'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Domain Allowlist ({domains.length})
          </button>
        </nav>
      </div>

      {activeTab === 'policies' ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowPolicyModal(true)}>Create Policy</Button>
          </div>

          {policies.length === 0 ? (
            <EmptyState
              title="No policies configured"
              description="Create policies to control agent behavior"
              action={{ label: 'Create Policy', onClick: () => setShowPolicyModal(true) }}
            />
          ) : (
            <div className="grid gap-4">
              {policies.map((policy) => (
                <Card key={policy.id}>
                  <div className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-lg font-medium text-gray-900">{policy.name}</h3>
                          <PolicyTypeBadge type={policy.type} />
                          <Badge variant={policy.enabled ? 'success' : 'default'}>
                            {policy.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-500">{policy.description}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-between items-center">
                      <p className="text-xs text-gray-400">
                        {policy.conditions.length} condition(s)
                      </p>
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePolicy(policy)}
                        >
                          {policy.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeletePolicy(policy.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowDomainModal(true)}>Add Domain Rule</Button>
          </div>

          {domains.length === 0 ? (
            <EmptyState
              title="No domain rules configured"
              description="Add domain rules to control navigation behavior"
              action={{ label: 'Add Domain Rule', onClick: () => setShowDomainModal(true) }}
            />
          ) : (
            <div className="grid gap-4">
              {domains.map((domain) => (
                <Card key={domain.id}>
                  <div className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-lg font-medium text-gray-900">{domain.domain}</h3>
                          <DomainActionBadge action={domain.action} />
                        </div>
                        <p className="text-sm text-gray-500">
                          Pattern: {domain.pattern || 'Exact match'}
                        </p>
                        {domain.description && (
                          <p className="text-sm text-gray-400">{domain.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleDomain(domain)}
                      >
                        Change to {domain.action === 'allow' ? 'Block' : domain.action === 'block' ? 'Require Approval' : 'Allow'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteDomain(domain.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {showPolicyModal && (
        <CreatePolicyModal
          onClose={() => setShowPolicyModal(false)}
          onSubmit={handleCreatePolicy}
        />
      )}

      {showDomainModal && (
        <CreateDomainModal
          onClose={() => setShowDomainModal(false)}
          onSubmit={handleCreateDomain}
        />
      )}
    </div>
  );
}

function PolicyTypeBadge({ type }: { type: Policy['type'] }) {
  const variants: Record<Policy['type'], 'info' | 'warning' | 'default'> = {
    domain: 'info',
    action: 'warning',
    approval: 'default',
  };

  return <Badge variant={variants[type]}>{type}</Badge>;
}

function DomainActionBadge({ action }: { action: DomainAllowlist['action'] }) {
  const variants: Record<DomainAllowlist['action'], 'success' | 'danger' | 'warning'> = {
    allow: 'success',
    block: 'danger',
    require_approval: 'warning',
  };

  const labels: Record<DomainAllowlist['action'], string> = {
    allow: 'Allow',
    block: 'Block',
    require_approval: 'Require Approval',
  };

  return <Badge variant={variants[action]}>{labels[action]}</Badge>;
}

interface CreatePolicyModalProps {
  onClose: () => void;
  onSubmit: (data: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

function CreatePolicyModal({ onClose, onSubmit }: CreatePolicyModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<Policy['type']>('action');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        description,
        type,
        enabled: true,
        conditions: [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Create Policy</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Policy Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Block social media"
            required
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this policy does..."
            rows={3}
            required
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Policy Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Policy['type'])}
              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="domain">Domain</option>
              <option value="action">Action</option>
              <option value="approval">Approval</option>
            </select>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Policy'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CreateDomainModalProps {
  onClose: () => void;
  onSubmit: (data: Omit<DomainAllowlist, 'id' | 'createdAt'>) => void;
}

function CreateDomainModal({ onClose, onSubmit }: CreateDomainModalProps) {
  const [domain, setDomain] = useState('');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<DomainAllowlist['action']>('allow');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        domain,
        pattern: pattern || domain,
        action,
        description: description || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Add Domain Rule</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g., example.com"
            required
          />
          <Input
            label="Pattern (optional)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="e.g., *.example.com (defaults to exact match)"
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as DomainAllowlist['action'])}
              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="allow">Allow</option>
              <option value="block">Block</option>
              <option value="require_approval">Require Approval</option>
            </select>
          </div>
          <Input
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why is this rule configured?"
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Domain Rule'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
