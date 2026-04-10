import { Group, Title, Text, Box, Stack } from '@mantine/core'
import { IconHome } from '@tabler/icons-react'

export function Header() {
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
      <Group align="flex-start" gap="md" wrap="wrap">
        <Group gap="xs" align="center">
          <IconHome size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Title order={1} style={{ fontSize: 'clamp(22px, 4vw, 28px)', lineHeight: 1.2 }}>
              Ипотечный стратег
            </Title>
            <Text c="dimmed" size="sm">
              Сравнение стратегий: досрочное погашение vs инвестиции
            </Text>
          </Stack>
        </Group>
      </Group>
    </Box>
  )
}
