import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import NetworkDomainsPage from './pages/NetworkDomainsPage'
import EdgeAgentsPage from './pages/EdgeAgentsPage'
import ConfigPreviewPage from './pages/ConfigPreviewPage'
import DeploymentsPage from './pages/DeploymentsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/network-domains" element={<NetworkDomainsPage />} />
        <Route path="/edge-agents" element={<EdgeAgentsPage />} />
        <Route path="/config-preview" element={<ConfigPreviewPage />} />
        <Route path="/deployments" element={<DeploymentsPage />} />
        <Route path="*" element={<Navigate to="/network-domains" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
