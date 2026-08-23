import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/home/HomePage'
import DomainsPage from './pages/admin/domains/DomainsPage'
import ResourcesPage from './pages/resources/ResourcesPage'
import LabelTemplatesPage from './pages/label-templates/LabelTemplatesPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin/domains" element={<DomainsPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/label-templates" element={<LabelTemplatesPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
