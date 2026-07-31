import { useState } from 'react';
import type { ApprovalRequest, ApprovalResponse } from '../types';
import { approvalApi } from '../api/client';
import { usePendingApprovals } from '../hooks';
import { Card, Button, Badge, Spinner, EmptyState, ErrorMessage } from '../components/Layout';

export function ApprovalsPage() {
  const { approvals, loading, error, refetch } = usePendingApprovals();
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [responding, setResponding] = useState(false);

  const handleRespond = async (response: ApprovalResponse['action']) => {
    if (!selectedApproval) return;

    setResponding(true);
    try {
      await approvalApi.respond({
        requestId: selectedApproval.id,
        action: response,
      });
      setSelectedApproval(null);
      refetch();
    } catch (err) {
      console.error('Failed to respond to approval:', err);
    } finally {
      setResponding(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Approvals</h1>
        <Badge variant="warning">{approvals.length} pending</Badge>
      </div>

      {approvals.length === 0 ? (
        <EmptyState
          title="No pending approvals"
          description="Critical actions requiring approval will appear here"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            {approvals.map((approval) => (
              <Card
                key={approval.id}
                onClick={() => setSelectedApproval(approval)}
                className={
                  selectedApproval?.id === approval.id ? 'ring-2 ring-blue-500' : ''
                }
              >
                <ApprovalCard approval={approval} />
              </Card>
            ))}
          </div>

          {selectedApproval && (
            <div className="lg:col-span-1">
              <ApprovalDetail
                approval={selectedApproval}
                onApprove={() => handleRespond('approve_once')}
                onDeny={() => handleRespond('deny')}
                onStopSession={() => handleRespond('stop_session')}
                onApproveContinue={() => handleRespond('approve_continue')}
                responding={responding}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ approval }: { approval: ApprovalRequest }) {
  return (
    <div className="p-4">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <h3 className="text-lg font-medium text-gray-900">{approval.taskName}</h3>
          <p className="text-sm text-gray-500">{approval.targetWebsite}</p>
        </div>
        <Badge variant="warning">Pending</Badge>
      </div>
      <div className="mt-3">
        <p className="text-sm font-medium text-gray-700">{approval.proposedAction}</p>
      </div>
      <div className="mt-3 flex justify-between items-center">
        <p className="text-xs text-gray-400">
          {new Date(approval.createdAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function ApprovalDetail({
  approval,
  onApprove,
  onDeny,
  onStopSession,
  onApproveContinue,
  responding,
}: {
  approval: ApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
  onStopSession: () => void;
  onApproveContinue: () => void;
  responding: boolean;
}) {
  return (
    <Card>
      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Approval Request</h3>
          <Badge variant="warning">Pending Review</Badge>
        </div>

        {/* Screenshot Preview */}
        {approval.screenshotUrl && (
          <div>
            <p className="text-sm font-medium text-gray-500 mb-2">Screenshot Preview</p>
            <img
              src={approval.screenshotUrl}
              alt="Page screenshot"
              className="w-full rounded-lg border border-gray-200"
            />
          </div>
        )}

        {/* Proposed Action */}
        <div>
          <p className="text-sm font-medium text-gray-500">Proposed Action</p>
          <p className="text-base text-gray-900">{approval.proposedAction}</p>
        </div>

        {/* Target Website */}
        <div>
          <p className="text-sm font-medium text-gray-500">Target Website</p>
          <p className="text-base text-gray-900">{approval.targetWebsite}</p>
        </div>

        {/* Relevant Field Names */}
        {approval.fieldNames.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-500">Relevant Field Names</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {approval.fieldNames.map((field, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-1 rounded bg-gray-100 text-sm text-gray-700"
                >
                  {field}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Data to Submit */}
        {Object.keys(approval.dataToSubmit).length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-500">Data That Will Be Submitted</p>
            <div className="mt-1 bg-gray-50 rounded-lg p-3">
              <table className="text-sm">
                <tbody>
                  {Object.entries(approval.dataToSubmit).map(([key, value]) => (
                    <tr key={key} className="border-b border-gray-200 last:border-0">
                      <td className="py-1 pr-4 font-medium text-gray-600">{key}:</td>
                      <td className="py-1 text-gray-900">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Expected Consequence */}
        <div>
          <p className="text-sm font-medium text-gray-500">Expected Consequence</p>
          <p className="text-base text-gray-900">{approval.expectedConsequence}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col space-y-3 pt-4 border-t border-gray-200">
          <div className="flex space-x-3">
            <Button
              variant="primary"
              onClick={onApprove}
              disabled={responding}
              className="flex-1"
            >
              Approve Once
            </Button>
            <Button
              variant="primary"
              onClick={onApproveContinue}
              disabled={responding}
              className="flex-1"
            >
              Approve & Continue
            </Button>
          </div>
          <div className="flex space-x-3">
            <Button
              variant="secondary"
              onClick={onDeny}
              disabled={responding}
              className="flex-1"
            >
              Deny
            </Button>
            <Button
              variant="danger"
              onClick={onStopSession}
              disabled={responding}
              className="flex-1"
            >
              Stop Session
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
