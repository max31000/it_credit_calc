export const formatRub = (v: number): string => {
  if (v >= 1_000_000) {
    return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} млн ₽`
  }
  return `${Math.round(v).toLocaleString('ru-RU')} ₽`
}

export const formatPct = (v: number): string => `${v.toFixed(1)}%`

export const formatMonths = (m: number): string => {
  const y = Math.floor(m / 12)
  const mo = m % 12
  if (y === 0) return `${mo} мес.`
  if (mo === 0) return `${y} ${y === 1 ? 'год' : y < 5 ? 'года' : 'лет'}`
  return `${y} г. ${mo} мес.`
}
