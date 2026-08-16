import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import NotifiersPage from './pages/NotifiersPage'
import RoutesPage from './pages/RoutesPage'
import SilencesPage from './pages/SilencesPage'
import InhibitionsPage from './pages/InhibitionsPage'
import AlertStatusPage from './pages/AlertStatusPage'
import ConfigPage from './pages/ConfigPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/notifiers" element={<NotifiersPage />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/silences" element={<SilencesPage />} />
        <Route path="/inhibitions" element={<InhibitionsPage />} />
        <Route path="/alerts" element={<AlertStatusPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/alerts" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
