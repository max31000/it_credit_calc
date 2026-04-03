import { Container, Stack } from '@mantine/core'
import type { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <Container size={1400} style={{ paddingLeft: 'clamp(16px, 3vw, 40px)', paddingRight: 'clamp(16px, 3vw, 40px)' }}>
      <Stack gap="xl">
        {children}
      </Stack>
    </Container>
  )
}
