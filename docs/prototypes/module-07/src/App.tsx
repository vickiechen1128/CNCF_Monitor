import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import ResourcesPage from './pages/ResourcesPage'
import LabelTemplatesPage from './pages/LabelTemplatesPage'
import ImportHistoryPage from './pages/ImportHistoryPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/label-templates" element={<LabelTemplatesPage />} />
        <Route path="/import-history" element={<ImportHistoryPage />} />
        <Route path="*" element={<Navigate to="/resources" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
