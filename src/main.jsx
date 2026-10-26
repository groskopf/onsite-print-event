import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import EventApp from './EventApp.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <EventApp />
  </StrictMode>,
)
