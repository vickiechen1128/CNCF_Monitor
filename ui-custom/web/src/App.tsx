import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/home/HomePage'
import DomainsPage from './pages/admin/domains/DomainsPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin/domains" element={<DomainsPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
