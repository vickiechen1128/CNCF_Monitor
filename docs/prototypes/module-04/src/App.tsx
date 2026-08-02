import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import { ProvidersPage } from './pages/ProvidersPage'
import { SyncPoliciesPage } from './pages/SyncPoliciesPage'
import { PendingCiPage } from './pages/PendingCiPage'
import { OrphansPage } from './pages/OrphansPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/sync-policies" element={<SyncPoliciesPage />} />
        <Route path="/pending-ci" element={<PendingCiPage />} />
        <Route path="/orphans" element={<OrphansPage />} />
        <Route path="*" element={<Navigate to="/providers" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
