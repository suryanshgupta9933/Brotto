import { useState, useEffect } from 'react';
import type { DownloadItem } from '../types';
import { downloadsApi } from '../api/client';
import { Card, Button, Badge, Spinner, ErrorMessage } from '../components/Layout';

export function DownloadsPage() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDownloads = async () => {
    try {
      const data = await downloadsApi.list();
      setDownloads(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load downloads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDownloads();
  }, []);

  const handleDownload = (item: DownloadItem) => {
    // In production, this would trigger the actual download
    window.open(item.url, '_blank');
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} onRetry={fetchDownloads} />;

  const connectors = downloads.filter((d) => d.type === 'connector');
  const extensions = downloads.filter((d) => d.type === 'extension');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Downloads</h1>
        <p className="text-gray-500">
          Download the Desktop Connector or Browser Extension to connect your browser to the control plane.
        </p>
      </div>

      {/* Desktop Connectors */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Desktop Connectors</h2>
        <p className="text-sm text-gray-500 mb-4">
          The Desktop Connector is a native application that launches a dedicated browser and creates a secure connection to the control plane.
        </p>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connectors.length === 0 ? (
            <p className="text-gray-500 col-span-full">No connectors available</p>
          ) : (
            connectors.map((item) => (
              <DownloadCard key={item.id} item={item} onDownload={handleDownload} />
            ))
          )}
        </div>
      </section>

      {/* Browser Extensions */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Browser Extensions</h2>
        <p className="text-sm text-gray-500 mb-4">
          The Browser Extension allows you to connect existing Chrome or Edge tabs to the control plane for automation.
        </p>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {extensions.length === 0 ? (
            <p className="text-gray-500 col-span-full">No extensions available</p>
          ) : (
            extensions.map((item) => (
              <DownloadCard key={item.id} item={item} onDownload={handleDownload} />
            ))
          )}
        </div>
      </section>

      {/* Installation Instructions */}
      <section className="bg-blue-50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-blue-900 mb-4">Installation Instructions</h2>
        <div className="space-y-4 text-sm text-blue-800">
          <div>
            <h3 className="font-medium mb-1">Desktop Connector</h3>
            <ol className="list-decimal list-inside space-y-1">
              <li>Download the appropriate connector for your platform</li>
              <li>Extract the ZIP file to a location of your choice</li>
              <li>Run the connector executable</li>
              <li>Enter the pairing code displayed on the device registration page</li>
            </ol>
          </div>
          <div>
            <h3 className="font-medium mb-1">Browser Extension</h3>
            <ol className="list-decimal list-inside space-y-1">
              <li>Download the extension package for your browser</li>
              <li>Open your browser's extension management page</li>
              <li>Enable "Developer mode"</li>
              <li>Click "Load unpacked" and select the extracted extension folder</li>
              <li>Navigate to the control plane and complete the pairing flow</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

function DownloadCard({
  item,
  onDownload,
}: {
  item: DownloadItem;
  onDownload: (item: DownloadItem) => void;
}) {
  const platformLabels: Record<DownloadItem['platform'], string> = {
    'windows-x64': 'Windows x64',
    'windows-arm64': 'Windows ARM64',
    'macos-x64': 'macOS Intel',
    'macos-arm64': 'macOS Apple Silicon',
    'linux-x64': 'Linux x64',
    'linux-arm64': 'Linux ARM64',
    'browser-extension': 'Browser Extension',
  };

  return (
    <Card>
      <div className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-medium text-gray-900">{item.name}</h3>
            <p className="text-sm text-gray-500">{platformLabels[item.platform]}</p>
          </div>
          <Badge variant="info">v{item.version}</Badge>
        </div>

        <div className="flex justify-between items-center text-sm text-gray-500">
          <span>{item.size}</span>
          <span>{new Date(item.releaseDate).toLocaleDateString()}</span>
        </div>

        <p className="text-xs text-gray-400">
          Checksum: {item.checksum.substring(0, 16)}...
        </p>

        <Button variant="primary" onClick={() => onDownload(item)} className="w-full">
          Download
        </Button>
      </div>
    </Card>
  );
}
