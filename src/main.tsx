import React from 'react'
import ReactDOM from 'react-dom/client'
// Порядок важен: Mantine, затем кит (токены --mvv-*, ремап Mantine-переменных, база), затем своё.
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mvv42/kit/styles.css'
import './app.css'
import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
