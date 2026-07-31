import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import Organizations from './pages/Organizations'
import Users from './pages/Users'
import ModelDeployment from './pages/ModelDeployment'
import PolicyTemplates from './pages/PolicyTemplates'
import SystemHealth from './pages/SystemHealth'
import Sessions from './pages/Sessions'
import AuditLogs from './pages/AuditLogs'

const navItems = [
  { path: '/', label: 'Organizations' },
  { path: '/users', label: 'Users' },
  { path: '/model-deployment', label: 'Model Deployment' },
  { path: '/policy-templates', label: 'Policy Templates' },
  { path: '/system-health', label: 'System Health' },
  { path: '/sessions', label: 'Sessions' },
  { path: '/audit-logs', label: 'Audit Logs' },
]

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{
        width: '240px',
        backgroundColor: '#1a1a1a',
        padding: '1rem 0',
        borderRight: '1px solid #333'
      }}>
        <div style={{ padding: '0 1rem 1rem', borderBottom: '1px solid #333', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.2rem', color: '#646cff' }}>Admin Console</h2>
        </div>
        <ul style={{ listStyle: 'none' }}>
          {navItems.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                style={{
                  display: 'block',
                  padding: '0.75rem 1rem',
                  color: location.pathname === item.path ? '#646cff' : 'inherit',
                  backgroundColor: location.pathname === item.path ? 'rgba(100, 108, 255, 0.1)' : 'transparent',
                  borderLeft: location.pathname === item.path ? '3px solid #646cff' : '3px solid transparent',
                  textDecoration: 'none',
                  transition: 'all 0.2s'
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main style={{ flex: 1, padding: '2rem' }}>
        {children}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Organizations />} />
          <Route path="/users" element={<Users />} />
          <Route path="/model-deployment" element={<ModelDeployment />} />
          <Route path="/policy-templates" element={<PolicyTemplates />} />
          <Route path="/system-health" element={<SystemHealth />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/audit-logs" element={<AuditLogs />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
