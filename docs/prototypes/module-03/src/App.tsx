import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import { GatewayRoutesPage } from './pages/GatewayRoutesPage'
import { AuthConfigPage } from './pages/AuthConfigPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/gateway-routes" element={<GatewayRoutesPage />} />
        <Route path="/auth-config" element={<AuthConfigPage />} />
        <Route path="*" element={<Navigate to="/gateway-routes" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
