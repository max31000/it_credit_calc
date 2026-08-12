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
import { TRACKER_ENABLED, ApiError } from './api/client'
import { useAuthStore } from './store/useAuthStore'
import { fetchMe } from './api/auth'

/** Общая шапка + контейнер для всех страниц */
function Shell() {
  return (
    <Layout>
      <Header />
      <Outlet />
    </Layout>
  )
}

function AppRoutes() {
  const token = useAuthStore((s) => s.token)
  const logout = useAuthStore((s) => s.logout)

  // Проверка сессии на старте: если токен невалиден/истёк, GET /api/auth/me вернёт 401 →
  // разлогиниваем. Сетевые и прочие ошибки (сервер недоступен и т.п.) сессию не трогают —
  // иначе временный сбой сети выкидывал бы пользователя из аккаунта.
  useEffect(() => {
    if (!TRACKER_ENABLED || !token) return
    fetchMe(token).catch((err) => {
      if (err instanceof ApiError && err.status === 401) logout()
    })
  }, [token, logout])

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
