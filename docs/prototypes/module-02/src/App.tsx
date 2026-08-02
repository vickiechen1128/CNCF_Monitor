import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import QueryPage from './pages/QueryPage'
import TargetsPage from './pages/TargetsPage'
import AlertStatusPage from './pages/AlertStatusPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/query" element={<QueryPage />} />
        <Route path="/targets" element={<TargetsPage />} />
        <Route path="/alert-status" element={<AlertStatusPage />} />
        <Route path="*" element={<Navigate to="/query" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
