import { Paper, Text } from '@mantine/core'
import { formatRub, formatMonths } from '../../lib/formatters'

interface TooltipPayloadItem {
  name: string
  value: number
  color: string
}

export interface ChartTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipPayloadItem>
  label?: string | number
  /** Префикс заголовка, например «Если слёт в мес.» */
  labelPrefix?: string
  /** Дополнительная строка снизу */
  footer?: string
}

export function ChartTooltip({ active, payload, label, labelPrefix, footer }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0 || label === undefined) return null
  const month = typeof label === 'string' ? parseFloat(label) : label

  return (
    <Paper shadow="sm" p="sm" radius="sm" style={{ minWidth: 220 }}>
      <Text size="xs" c="dimmed" mb={4}>
        {labelPrefix ?? 'Месяц'} {month} ({formatMonths(month)})
      </Text>
      {payload.map((item) => (
        <Text key={item.name} size="xs" style={{ color: item.color }}>
          {item.name}: {formatRub(item.value)}
        </Text>
      ))}
      {footer && (
        <Text size="xs" c="dimmed" mt={4}>
          {footer}
        </Text>
      )}
    </Paper>
  )
}
