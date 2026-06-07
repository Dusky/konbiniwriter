import React from 'react'
import ReactDOM from 'react-dom/client'
// Initialize the browser API implementation before anything else renders
import './lib/browserApi'
import App from './App'
import './styles/theme.css'
import './styles/ai.css'
import './styles/lifecycle.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
