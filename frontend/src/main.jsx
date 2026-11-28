import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { isDemoMode } from './demo'
import './index.css'

if (isDemoMode) {
  document.title = 'Lab Software Demo'
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
