import { Paper, Text, Tooltip } from '@mantine/core'
import type { ReactNode } from 'react'

type MetricColor = 'default' | 'red' | 'blue' | 'green' | 'orange' | 'gray'

interface MetricCardProps {
  label: string
  value: string
  color?: MetricColor
  description?: string
  bg?: string
  tooltip?: string
  children?: ReactNode
}

const colorMap: Record<MetricColor, string> = {
  default: 'inherit',
  red: 'var(--mantine-color-red-7)',
  blue: 'var(--mantine-color-blue-7)',
  green: 'var(--mantine-color-green-7)',
  orange: 'var(--mantine-color-orange-7)',
  gray: 'var(--mantine-color-gray-5)',
}

export function MetricCard({
  label,
  value,
  color = 'default',
  description,
  bg,
  tooltip,
  children,
}: MetricCardProps) {
  const card = (
    <Paper
      bg={bg}
      p="md"
      radius="md"
      style={{ height: '100%', backgroundColor: bg ? undefined : 'var(--mantine-color-gray-light)' }}
    >
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} mb={4}>
        {label}
      </Text>
      <Text
        size="xl"
        fw={700}
        style={{ color: colorMap[color] }}
      >
        {value}
      </Text>
      {description && (
        <Text size="xs" c="dimmed" mt={4}>
          {description}
        </Text>
      )}
      {children}
    </Paper>
  )

  if (tooltip) {
    return (
      <Tooltip label={tooltip} multiline w={280} withArrow>
        {card}
      </Tooltip>
    )
  }

  return card
}
