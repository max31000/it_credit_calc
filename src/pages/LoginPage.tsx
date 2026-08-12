import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Center, Paper, Title, Text, Stack, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useAuthStore } from '../store/useAuthStore'
import { loginWithTelegram, type TelegramAuthData } from '../api/auth'

const BOT_USERNAME = 'mv_cashpulse_bot'

// Telegram Login Widget вызывает глобальный колбэк после авторизации
declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthData) => void
  }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setAuth = useAuthStore((s) => s.setAuth)
  const containerRef = useRef<HTMLDivElement>(null)

  // Если уже залогинены — сразу в трекер
  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/tracker', { replace: true })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    window.onTelegramAuth = async (telegramData: TelegramAuthData) => {
      try {
        const { token, user } = await loginWithTelegram(telegramData)
        setAuth(token, user)
        navigate('/tracker', { replace: true })
      } catch (err) {
        notifications.show({
          title: 'Ошибка входа',
          message: err instanceof Error ? err.message : 'Не удалось войти через Telegram',
          color: 'red',
        })
      }
    }

    const container = containerRef.current
    if (!container) return

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', BOT_USERNAME)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true

    container.appendChild(script)

    return () => {
      container.innerHTML = ''
      delete window.onTelegramAuth
    }
  }, [navigate, setAuth])

  return (
    <Center mih="60vh">
      <Stack align="center" gap="xl">
        <Stack align="center" gap="xs">
          <Title order={2}>Вход через Telegram</Title>
          <Text c="dimmed" size="sm" ta="center" maw={360}>
            Вход нужен только для трекера, калькулятор работает без него.
          </Text>
        </Stack>

        <Paper shadow="md" p="xl" radius="md" w={340}>
          <Stack align="center" gap="lg">
            <div ref={containerRef} style={{ minHeight: 48 }}>
              <Loader size="sm" />
            </div>
          </Stack>
        </Paper>
      </Stack>
    </Center>
  )
}
