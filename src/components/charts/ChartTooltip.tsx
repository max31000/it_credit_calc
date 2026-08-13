import { Paper, Text } from '@mantine/core'
import { formatRub, formatMonths, formatMonthsAgo } from '../../lib/formatters'
import { yearTickFormatter } from './chartUtils'

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
  /**
   * 'year' — ось X это года, а не месяцы от выдачи (вкладка «Движение денег», §7.3 спеки
   * continuous-simulation). По умолчанию 'month' — прежнее поведение.
   */
  mode?: 'month' | 'year'
  /** Форматирование значений payload; по умолчанию `formatRub`. На вкладке «Движение денег»
   *  значения — суммы за год, а не остатки, но по умолчанию формат тот же (₽). */
  valueFormatter?: (v: number) => string
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelPrefix,
  footer,
  todayMonth,
  startedOn,
  mode = 'month',
  valueFormatter = formatRub,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0 || label === undefined) return null
  const x = typeof label === 'string' ? parseFloat(label) : label

  let headerLine: string
  if (mode === 'year') {
    headerLine = `${labelPrefix ?? 'Год'} ${yearTickFormatter(x)}`
  } else {
    // Режим ипотеки: заголовок показывает и абсолютный месяц ипотеки, и календарную дату,
    // и позицию относительно «сегодня» (§5.4 дизайна docs/specs/2026-08-13-mortgage-timeline-design.md).
    const showTimeline = todayMonth !== undefined
    if (showTimeline) {
      const diff = x - todayMonth
      const relative = diff === 0 ? 'сейчас' : diff > 0 ? `через ${formatMonths(diff)} от сегодня` : formatMonthsAgo(-diff)
      const calendarPart = startedOn ? ` · ${formatMonthKeyAsMMYYYY(monthKeyFromDate(startedOn) + x)}` : ''
      headerLine = `${labelPrefix ?? 'Месяц'} ${x} ипотеки${calendarPart} · ${relative}`
    } else {
      headerLine = `${labelPrefix ?? 'Месяц'} ${x} (${formatMonths(x)})`
    }
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
            {item.name}: {valueFormatter(item.value as number)}
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
