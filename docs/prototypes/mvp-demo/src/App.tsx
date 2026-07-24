import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import ResourcesPage from './pages/ResourcesPage'
import ConfigPage from './pages/ConfigPage'
import ConfigPreviewPage from './pages/ConfigPreviewPage'
import QueryPage from './pages/QueryPage'
import CollectionPage from './pages/CollectionPage'
import AlertsPage from './pages/AlertsPage'
import NetworkDomainsPage from './pages/NetworkDomainsPage'
import MonitoringSourcesPage from './pages/MonitoringSourcesPage'
import './App.css'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/config-preview" element={<ConfigPreviewPage />} />
        <Route path="/query" element={<QueryPage />} />
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/network-domains" element={<NetworkDomainsPage />} />
        <Route path="/monitoring-sources" element={<MonitoringSourcesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
