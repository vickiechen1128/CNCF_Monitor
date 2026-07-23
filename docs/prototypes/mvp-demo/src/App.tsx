import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import ResourcesPage from './pages/ResourcesPage'
import ConfigPage from './pages/ConfigPage'
import ConfigPreviewPage from './pages/ConfigPreviewPage'
import QueryPage from './pages/QueryPage'
import CollectionPage from './pages/CollectionPage'
import AlertsPage from './pages/AlertsPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/config-preview" element={<ConfigPreviewPage />} />
        <Route path="/query" element={<QueryPage />} />
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
