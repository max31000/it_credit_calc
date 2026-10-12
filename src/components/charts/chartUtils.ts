import { chartColors } from '@mvv42/kit/charts'

/**
 * Цвета линий — единые для всех графиков, из палитры кита (CSS-переменные `--mvv-chart-*` и семантика,
 * сами переключаются light/dark). Серии закреплены за сущностями: «гасить досрочно» и «копить» везде
 * одного цвета; красный/зелёный — только по смыслу (потери/слёт, погашение).
 */
export const CHART_COLORS = {
  save: chartColors.series[0], // копить
  prepay: chartColors.series[1], // гасить досрочно
  savingsLine: chartColors.series[2], // накопления
  safety: chartColors.series[6], // точка безопасности
  danger: chartColors.negative,
  slip: chartColors.negative,
  payoff: chartColors.positive,
  neutral: chartColors.neutral,
  surface: chartColors.surface,
} as const

export function formatYAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)} тыс`
  return String(v)
}

export function xTickFormatter(v: number): string {
  return v % 12 === 0 ? `${v / 12}г.` : ''
}

/**
 * Подпись года на оси вкладки «Движение денег» (§7.3 спеки continuous-simulation).
 * Календарный год (режим ипотеки) — как есть; порядковый год прогноза (гость) — «N-й год».
 */
export function yearTickFormatter(year: number): string {
  return year > 1000 ? String(year) : `${year}-й год`
}
