import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import { TenantProvider } from './contexts/TenantContext'
import QueryPage from './pages/QueryPage'
import TargetsPage from './pages/TargetsPage'

function App() {
  return (
    <TenantProvider>
      <HashRouter>
        <Routes>
          <Route path="/query" element={<QueryPage />} />
          <Route path="/targets" element={<TargetsPage />} />
          <Route path="*" element={<Navigate to="/query" replace />} />
        </Routes>
      </HashRouter>
    </TenantProvider>
  )
}

export default App
