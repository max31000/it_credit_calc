import { useComputedColorScheme } from '@mantine/core'

/** Цвета линий: единые для всех графиков */
export const CHART_COLORS = {
  prepay: '#f76707', // гасить досрочно
  save: '#228be6', // копить
  savingsLine: '#12b886',
  danger: '#fa5252',
  safety: '#7950f2',
  payoff: '#2f9e44',
  slip: '#e03131',
  neutral: '#868e96',
} as const

export function useChartTheme() {
  const isDark = useComputedColorScheme('light') === 'dark'
  return {
    gridColor: isDark ? '#373A40' : '#e9ecef',
    tickColor: isDark ? '#909296' : '#868e96',
  }
}

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
