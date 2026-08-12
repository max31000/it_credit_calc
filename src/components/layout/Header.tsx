import { Group, Title, Text, Box, Stack, Anchor, Button } from '@mantine/core'
import { IconHome } from '@tabler/icons-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { TRACKER_ENABLED } from '../../api/client'
import { useAuthStore } from '../../store/useAuthStore'

export function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated())
  const logout = useAuthStore((s) => s.logout)

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <Box
      component="header"
      style={{
        backgroundColor: 'var(--mantine-color-body)',
        borderBottom: '1px solid var(--mantine-color-default-border)',
        paddingTop: 20,
        paddingBottom: 20,
      }}
    >
      <Group align="flex-start" justify="space-between" gap="md" wrap="wrap">
        <Group gap="xs" align="center">
          <IconHome size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Title order={1} style={{ fontSize: 'clamp(22px, 4vw, 28px)', lineHeight: 1.2 }}>
              Ипотечный стратег
            </Title>
            <Text c="dimmed" size="sm">
              Платёж, точка полного погашения и цена слёта с льготной программы
            </Text>
          </Stack>
        </Group>

        {TRACKER_ENABLED && (
          <Group gap="md" align="center">
            <Anchor component={Link} to="/" fw={location.pathname === '/' ? 700 : 400} underline="hover">
              Калькулятор
            </Anchor>
            <Anchor
              component={Link}
              to="/tracker"
              fw={location.pathname.startsWith('/tracker') ? 700 : 400}
              underline="hover"
            >
              Трекер
            </Anchor>
            {isAuthenticated ? (
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {user?.firstName ?? user?.username ?? 'Профиль'}
                </Text>
                <Button size="xs" variant="default" onClick={handleLogout}>
                  Выйти
                </Button>
              </Group>
            ) : (
              <Button size="xs" component={Link} to="/login">
                Войти
              </Button>
            )}
          </Group>
        )}
      </Group>
    </Box>
  )
}
