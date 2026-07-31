import React, { useState, useEffect } from 'react';
import type { Device } from '../types';
import { deviceApi } from '../api/client';
import { Card, Button, Input, Badge, Spinner, EmptyState, ErrorMessage } from '../components/Layout';

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  const fetchDevices = async () => {
    try {
      const data = await deviceApi.list();
      setDevices(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const handleUnregister = async (deviceId: string) => {
    if (!confirm('Are you sure you want to unregister this device?')) return;
    try {
      await deviceApi.unregister(deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unregister device');
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} onRetry={fetchDevices} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Devices</h1>
        <Button onClick={() => setShowRegisterModal(true)}>Register Device</Button>
      </div>

      {devices.length === 0 ? (
        <EmptyState
          title="No devices registered"
          description="Register a desktop connector or browser extension to get started"
          action={{ label: 'Register Device', onClick: () => setShowRegisterModal(true) }}
        />
      ) : (
        <div className="grid gap-4">
          {devices.map((device) => (
            <Card key={device.id}>
              <div className="p-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="text-lg font-medium text-gray-900">{device.name}</h3>
                      <DeviceTypeBadge type={device.type} />
                      <DeviceStatusBadge status={device.status} />
                    </div>
                    <p className="text-sm text-gray-500">
                      Registered {new Date(device.registeredAt).toLocaleDateString()}
                    </p>
                    {device.version && (
                      <p className="text-sm text-gray-400">Version: {device.version}</p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex justify-between items-center">
                  <p className="text-xs text-gray-400">
                    Last seen: {new Date(device.lastSeenAt).toLocaleString()}
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleUnregister(device.id)}
                  >
                    Unregister
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showRegisterModal && (
        <RegisterDeviceModal
          onClose={() => setShowRegisterModal(false)}
          onRegister={(device) => {
            setDevices((prev) => [...prev, device]);
            setShowRegisterModal(false);
          }}
        />
      )}
    </div>
  );
}

function DeviceTypeBadge({ type }: { type: Device['type'] }) {
  const variants: Record<Device['type'], 'info' | 'default'> = {
    desktop_connector: 'info',
    browser_extension: 'default',
  };

  const labels: Record<Device['type'], string> = {
    desktop_connector: 'Desktop Connector',
    browser_extension: 'Browser Extension',
  };

  return <Badge variant={variants[type]}>{labels[type]}</Badge>;
}

function DeviceStatusBadge({ status }: { status: Device['status'] }) {
  const variants: Record<Device['status'], 'success' | 'danger' | 'default'> = {
    online: 'success',
    offline: 'danger',
    registered: 'default',
  };

  return <Badge variant={variants[status]}>{status}</Badge>;
}

interface RegisterDeviceModalProps {
  onClose: () => void;
  onRegister: (device: Device) => void;
}

function RegisterDeviceModal({ onClose, onRegister }: RegisterDeviceModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Device['type']>('desktop_connector');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // For demo purposes, we generate a random public key
      // In production, this would come from the actual device registration flow
      const publicKey = `pk_${Math.random().toString(36).substring(2, 50)}`;
      const device = await deviceApi.register({ name, type, publicKey });
      onRegister(device);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register device');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Register Device</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <p className="text-sm text-gray-600 mb-4">
          To register a device, you need to install the{' '}
          {type === 'desktop_connector' ? 'Desktop Connector' : 'Browser Extension'} first.
          Download links are available on the{' '}
          <a href="/downloads" className="text-blue-600 hover:underline">
            Downloads
          </a>{' '}
          page.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Device Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., My MacBook Pro"
            required
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Device Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Device['type'])}
              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="desktop_connector">Desktop Connector</option>
              <option value="browser_extension">Browser Extension</option>
            </select>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Registering...' : 'Register Device'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
