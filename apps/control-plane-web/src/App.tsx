import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { TasksPage } from './pages/TasksPage';
import { SessionsPage } from './pages/SessionsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { AuditPage } from './pages/AuditPage';
import { DevicesPage } from './pages/DevicesPage';
import { DownloadsPage } from './pages/DownloadsPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<TasksPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
