import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import AlertingRulesPage from './pages/AlertingRulesPage'
import RuleGroupsPage from './pages/RuleGroupsPage'
import SilencesPage from './pages/SilencesPage'
import NotifiersPage from './pages/NotifiersPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/alerting-rules" element={<AlertingRulesPage />} />
        <Route path="/rule-groups" element={<RuleGroupsPage />} />
        <Route path="/silences" element={<SilencesPage />} />
        <Route path="/notifiers" element={<NotifiersPage />} />
        <Route path="*" element={<Navigate to="/alerting-rules" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
