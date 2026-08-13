import { useEffect } from 'react'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { Notifications } from '@mantine/notifications'
import '@mantine/notifications/styles.css'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { Header } from './components/layout/Header'
import CalculatorPage from './pages/CalculatorPage'
import LoginPage from './pages/LoginPage'
import TrackerListPage from './pages/TrackerListPage'
import MortgagePage from './pages/MortgagePage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AccountSettingsSync } from './components/AccountSettingsSync'
import { TRACKER_ENABLED, ApiError } from './api/client'
import { useAuthStore } from './store/useAuthStore'
import { useCalculatorStore } from './store/useCalculatorStore'
import { fetchMe } from './api/auth'

/** Общая шапка + контейнер для всех страниц. AccountSettingsSync без разметки —
 *  сам решает, делать ли запросы (TRACKER_ENABLED && isAuthenticated, G12). */
function Shell() {
  return (
    <Layout>
      <AccountSettingsSync />
      <Header />
      <Outlet />
    </Layout>
  )
}

function AppRoutes() {
  const token = useAuthStore((s) => s.token)
  const logout = useAuthStore((s) => s.logout)
  const exitMortgageMode = useCalculatorStore((s) => s.exitMortgageMode)

  // Проверка сессии на старте: если токен невалиден/истёк, GET /api/auth/me вернёт 401 →
  // разлогиниваем. Сетевые и прочие ошибки (сервер недоступен и т.п.) сессию не трогают —
  // иначе временный сбой сети выкидывал бы пользователя из аккаунта.
  // exitMortgageMode() — как в Header.handleLogout и api/client.ts (G4): fetchMe ходит мимо
  // apiClient (голый fetch), поэтому его 401 не проходит через общий перехватчик, и без этой
  // строки персистированный режим ипотеки пережил бы истечение сессии — разлогиненный гость
  // (или следующий пользователь на этом устройстве) увидел бы чужой баннер.
  useEffect(() => {
    if (!TRACKER_ENABLED || !token) return
    fetchMe(token).catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        exitMortgageMode()
        logout()
      }
    })
  }, [token, logout, exitMortgageMode])

  if (!TRACKER_ENABLED) {
    // GitHub Pages: трекер полностью скрыт, /tracker* и /login недоступны
    return (
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<CalculatorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<CalculatorPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/tracker" element={<TrackerListPage />} />
          <Route path="/tracker/new" element={<TrackerListPage />} />
          <Route path="/tracker/:id" element={<MortgagePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <Notifications position="top-right" autoClose={5000} />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppRoutes />
      </BrowserRouter>
    </MantineProvider>
  )
}

export default App
