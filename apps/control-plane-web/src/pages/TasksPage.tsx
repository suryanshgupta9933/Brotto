import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task, CreateTaskRequest } from '../types';
import { taskApi } from '../api/client';
import { Card, Button, Input, Textarea, Badge, Spinner, EmptyState, ErrorMessage } from '../components/Layout';
import { useStore } from '../store';

export function TasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const setSelectedTaskId = useStore((state) => state.setSelectedTaskId);

  const fetchTasks = async () => {
    try {
      const data = await taskApi.list();
      setTasks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleCreateTask = async (data: CreateTaskRequest) => {
    try {
      const task = await taskApi.create(data);
      setTasks((prev) => [task, ...prev]);
      setShowCreateModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      await taskApi.cancel(taskId);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'cancelled' as const } : t))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel task');
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTaskId(task.id);
    navigate(`/sessions?taskId=${task.id}`);
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} onRetry={fetchTasks} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
        <Button onClick={() => setShowCreateModal(true)}>Create Task</Button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Create your first task to start automating browser actions"
          action={{ label: 'Create Task', onClick: () => setShowCreateModal(true) }}
        />
      ) : (
        <div className="grid gap-4">
          {tasks.map((task) => (
            <Card key={task.id} onClick={() => handleTaskClick(task)}>
              <div className="p-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium text-gray-900">{task.name}</h3>
                    <p className="text-sm text-gray-500 line-clamp-2">{task.goal}</p>
                  </div>
                  <TaskStatusBadge status={task.status} />
                </div>
                <div className="mt-4 flex justify-between items-center">
                  <p className="text-xs text-gray-400">
                    Created {new Date(task.createdAt).toLocaleString()}
                  </p>
                  {task.status === 'running' && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelTask(task.id);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTask}
        />
      )}
    </div>
  );
}

function TaskStatusBadge({ status }: { status: Task['status'] }) {
  const variants: Record<Task['status'], 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
    pending: 'warning',
    running: 'info',
    completed: 'success',
    failed: 'danger',
    cancelled: 'default',
  };

  const labels: Record<Task['status'], string> = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

interface CreateTaskModalProps {
  onClose: () => void;
  onSubmit: (data: CreateTaskRequest) => void;
}

function CreateTaskModal({ onClose, onSubmit }: CreateTaskModalProps) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [domain, setDomain] = useState('');
  const [maxSteps, setMaxSteps] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        goal,
        domain: domain || undefined,
        budget: maxSteps
          ? { maxSteps: parseInt(maxSteps, 10) }
          : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Create New Task</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Task Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Research competitor prices"
            required
          />
          <Textarea
            label="Goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Describe what you want the agent to accomplish..."
            rows={4}
            required
          />
          <Input
            label="Target Domain (optional)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g., example.com"
          />
          <Input
            label="Max Steps (optional)"
            type="number"
            value={maxSteps}
            onChange={(e) => setMaxSteps(e.target.value)}
            placeholder="Leave empty for default"
            min="1"
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
