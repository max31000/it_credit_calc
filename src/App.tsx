import { Mvv42Provider, LoginRequired } from '@mvv42/kit'
import { AppLayout, type NavItem } from '@mvv42/kit/router'
import { IconCalculator, IconHome, IconListDetails } from '@tabler/icons-react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import CalculatorPage from './pages/CalculatorPage'
import TrackerListPage from './pages/TrackerListPage'
import MortgagePage from './pages/MortgagePage'
import { AccountSettingsSync } from './components/AccountSettingsSync'
import { SERVICE_ID, TRACKER_ENABLED } from './api/client'

const NAV: NavItem[] = TRACKER_ENABLED
  ? [
      { label: 'Калькулятор', to: '/', icon: <IconCalculator /> },
      { label: 'Трекер', to: '/tracker', icon: <IconListDetails />, end: false },
    ]
  : []

/** Трекер — только для вошедших (общий mvv42-auth); калькулятор доступен анонимно. */
function Tracker({ children }: { children: React.ReactNode }) {
  return (
    <LoginRequired
      title="Войдите, чтобы вести трекер"
      description="Трекер хранит ваши ипотеки и корректировки на сервере. Калькулятор работает и без входа."
    >
      {children}
    </LoginRequired>
  )
}

function AppRoutes() {
  if (!TRACKER_ENABLED) {
    // Сборка без VITE_API_BASE: трекер полностью скрыт, /tracker* недоступны
    return (
      <Routes>
        <Route path="/" element={<CalculatorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<CalculatorPage />} />
      <Route path="/tracker" element={<Tracker><TrackerListPage /></Tracker>} />
      <Route path="/tracker/new" element={<Tracker><TrackerListPage /></Tracker>} />
      <Route path="/tracker/:id" element={<Tracker><MortgagePage /></Tracker>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <Mvv42Provider serviceId={SERVICE_ID} accent="green">
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppLayout title="Ипотечный стратег" icon={<IconHome />} nav={NAV}>
          {/* без разметки: синхронизация настроек аккаунта, только для вошедшего пользователя */}
          <AccountSettingsSync />
          <AppRoutes />
        </AppLayout>
      </BrowserRouter>
    </Mvv42Provider>
  )
}

export default App
