import { useState, useEffect } from 'react';
import type { AuditLogEntry } from '../types';
import { auditApi } from '../api/client';
import { Card, Button, Input, Spinner, EmptyState, ErrorMessage } from '../components/Layout';

export function AuditPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    eventType: '',
    userId: '',
  });
  const [page, setPage] = useState(0);
  const limit = 20;

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const data = await auditApi.list({
        ...filters,
        limit,
        offset: page * limit,
      });
      setEntries(data.entries);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [filters, page]);

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const handleExport = async () => {
    try {
      const csv = await auditApi.export({
        format: 'csv',
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      // Download the CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export audit log');
    }
  };

  const totalPages = Math.ceil(total / limit);

  if (error && entries.length === 0) {
    return <ErrorMessage message={error} onRetry={fetchEntries} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <Button variant="secondary" onClick={handleExport}>
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Input
              type="date"
              label="Start Date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
            />
            <Input
              type="date"
              label="End Date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
            />
            <Input
              label="Event Type"
              value={filters.eventType}
              onChange={(e) => handleFilterChange('eventType', e.target.value)}
              placeholder="e.g., session.started"
            />
            <Input
              label="User ID"
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
              placeholder="Filter by user"
            />
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setFilters({ startDate: '', endDate: '', eventType: '', userId: '' });
                  setPage(0);
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Results count */}
      <p className="text-sm text-gray-500">
        Showing {entries.length} of {total} entries
      </p>

      {/* Loading state */}
      {loading && entries.length === 0 && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {/* Entries */}
      {entries.length === 0 && !loading ? (
        <EmptyState
          title="No audit entries found"
          description="Audit entries will appear here as actions are performed"
        />
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <div className="p-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <p className="font-medium text-gray-900">{entry.action}</p>
                      <span className="text-gray-400">•</span>
                      <p className="text-sm text-gray-500">{entry.eventType}</p>
                    </div>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-sm text-gray-500 cursor-pointer">
                          View details
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-auto">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex justify-between items-center text-xs text-gray-400">
                  <div className="space-x-4">
                    <span>User: {entry.userId}</span>
                    {entry.sessionId && <span>Session: {entry.sessionId}</span>}
                    {entry.taskId && <span>Task: {entry.taskId}</span>}
                    {entry.ipAddress && <span>IP: {entry.ipAddress}</span>}
                  </div>
                  <span>{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center space-x-4">
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-gray-600">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="secondary"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
