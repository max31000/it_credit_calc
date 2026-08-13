import { Paper, Text } from '@mantine/core'
import { formatRub, formatMonths, formatMonthsAgo } from '../../lib/formatters'

interface TooltipPayloadItem {
  name: string
  /** null — точка не заполнена в этой части ряда (разрыв истории/прогноза, §2.3 дизайна) */
  value: number | null
  color: string
}

/** Индекс календарного месяца: year*12 + (month-1) — та же арифметика, что в timeline.ts */
function monthKeyFromDate(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return y * 12 + (m - 1)
}

function formatMonthKeyAsMMYYYY(key: number): string {
  const y = Math.floor(key / 12)
  const m = key - y * 12 + 1
  return `${String(m).padStart(2, '0')}.${y}`
}

export interface ChartTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipPayloadItem>
  label?: string | number
  /** Префикс заголовка, например «Если слёт в мес.» */
  labelPrefix?: string
  /** Дополнительная строка снизу */
  footer?: string
  /** Абсолютный месяц «сегодня» на оси таймлайна — присутствие включает режим ипотеки (§5.4 дизайна) */
  todayMonth?: number
  /** 'YYYY-MM-DD' дата выдачи ипотеки; null/undefined — календарную подпись не показываем */
  startedOn?: string | null
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelPrefix,
  footer,
  todayMonth,
  startedOn,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0 || label === undefined) return null
  const month = typeof label === 'string' ? parseFloat(label) : label

  // Режим ипотеки: заголовок показывает и абсолютный месяц ипотеки, и календарную дату,
  // и позицию относительно «сегодня» (§5.4 дизайна docs/specs/2026-08-13-mortgage-timeline-design.md).
  const showTimeline = todayMonth !== undefined
  let headerLine: string
  if (showTimeline) {
    const diff = month - todayMonth
    const relative = diff === 0 ? 'сейчас' : diff > 0 ? `через ${formatMonths(diff)} от сегодня` : formatMonthsAgo(-diff)
    const calendarPart = startedOn ? ` · ${formatMonthKeyAsMMYYYY(monthKeyFromDate(startedOn) + month)}` : ''
    headerLine = `${labelPrefix ?? 'Месяц'} ${month} ипотеки${calendarPart} · ${relative}`
  } else {
    headerLine = `${labelPrefix ?? 'Месяц'} ${month} (${formatMonths(month)})`
  }

  return (
    <Paper shadow="sm" p="sm" radius="sm" style={{ minWidth: 220 }}>
      <Text size="xs" c="dimmed" mb={4}>
        {headerLine}
      </Text>
      {payload
        .filter((item) => item.value !== null && item.value !== undefined)
        .map((item) => (
          <Text key={item.name} size="xs" style={{ color: item.color }}>
            {item.name}: {formatRub(item.value as number)}
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
