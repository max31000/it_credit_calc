import { ChartTooltip as KitChartTooltip } from '@mvv42/kit/charts'
import { formatRub, formatMonths, formatMonthsAgo } from '../../lib/formatters'
import { yearTickFormatter } from './chartUtils'

interface TooltipPayloadItem {
  name?: unknown
  /** null — точка не заполнена в этой части ряда (разрыв истории/прогноза, §2.3 дизайна) */
  value?: unknown
  color?: string
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
  /** Форматирование значений payload; по умолчанию `formatRub`. */
  valueFormatter?: (v: number) => string
}

/** Заголовок подсказки: месяц/год с учётом режима ипотеки (абсолютный месяц, дата, «сегодня»). */
function tooltipHeader(
  x: number,
  { labelPrefix, todayMonth, startedOn, mode = 'month' }: Pick<ChartTooltipProps, 'labelPrefix' | 'todayMonth' | 'startedOn' | 'mode'>,
): string {
  if (mode === 'year') return `${labelPrefix ?? 'Год'} ${yearTickFormatter(x)}`
  // Режим ипотеки: заголовок показывает и абсолютный месяц ипотеки, и календарную дату,
  // и позицию относительно «сегодня» (§5.4 дизайна docs/specs/2026-08-13-mortgage-timeline-design.md).
  if (todayMonth !== undefined) {
    const diff = x - todayMonth
    const relative = diff === 0 ? 'сейчас' : diff > 0 ? `через ${formatMonths(diff)} от сегодня` : formatMonthsAgo(-diff)
    const calendarPart = startedOn ? ` · ${formatMonthKeyAsMMYYYY(monthKeyFromDate(startedOn) + x)}` : ''
    return `${labelPrefix ?? 'Месяц'} ${x} ипотеки${calendarPart} · ${relative}`
  }
  return `${labelPrefix ?? 'Месяц'} ${x} (${formatMonths(x)})`
}

/** Подсказка графиков калькулятора — карточка кита (пропуск null-точек, note) со своим заголовком и рублями. */
export function ChartTooltip({ active, payload, label, footer, valueFormatter = formatRub, ...header }: ChartTooltipProps) {
  if (!active || label === undefined) return null
  return (
    <KitChartTooltip
      active={active}
      payload={payload}
      label={label}
      labelFormatter={(l) => tooltipHeader(typeof l === 'string' ? parseFloat(l) : Number(l), header)}
      valueFormatter={(v) => valueFormatter(Number(v))}
      note={footer}
    />
  )
}
