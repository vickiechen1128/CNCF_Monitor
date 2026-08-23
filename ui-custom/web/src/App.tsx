import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/home/HomePage'
import DomainsPage from './pages/admin/domains/DomainsPage'
import ResourcesPage from './pages/resources/ResourcesPage'
import LabelTemplatesPage from './pages/label-templates/LabelTemplatesPage'
import ScrapeJobListPage from './pages/strategy/ScrapeJobListPage'
import RulesPage from './pages/strategy/RulesPage'
import MetricLibraryPage from './pages/strategy/MetricLibraryPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin/domains" element={<DomainsPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/label-templates" element={<LabelTemplatesPage />} />
        <Route path="/scrape-jobs" element={<ScrapeJobListPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/metric-library" element={<MetricLibraryPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
