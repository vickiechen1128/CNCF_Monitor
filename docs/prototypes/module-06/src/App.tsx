import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import { TenantsPage } from './pages/TenantsPage'
import { UsersPage } from './pages/UsersPage'
import { AuditLogsPage } from './pages/AuditLogsPage'
import { PlatformSettingsPage } from './pages/PlatformSettingsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/tenants" element={<TenantsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="/platform-settings" element={<PlatformSettingsPage />} />
        <Route path="*" element={<Navigate to="/tenants" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
