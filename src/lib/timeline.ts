/**
 * Presentation-слой «история + прогноз» для графиков (§2.3, §5.1 дизайна
 * docs/specs/2026-08-13-mortgage-timeline-design.md). Чистый модуль: без React,
 * без `new Date()`, не зависит от `tracker.ts` (обратной стрелки engine → tracker нет и не будет).
 *
 * Движок (`engine.ts`) не знает про даты и время до «сегодня» — его `series[0]` всегда
 * «начало прогноза». Этот модуль склеивает прошлое (компактный ряд остатков из трекера)
 * и будущее (`series`) в единую ось «месяц от выдачи ипотеки».
 */
import type { CalculationResult } from './engine'

/** Одна точка склеенного ряда: абсолютный месяц от выдачи ипотеки */
export interface TimelinePoint {
  /** Абсолютный месяц: 0 — выдача ипотеки (в гостевом сценарии совпадает с «сегодня») */
  month: number
  /** Факт по трекеру; null для месяцев после «сегодня» */
  debtFact: number | null
  /** −debtFact — нижняя граница капитала в прошлом (§1.2 дизайна); null после «сегодня» */
  netWorthFact: number | null
  /** Прогноз; null для месяцев до «сегодня» */
  debtPrepay: number | null
  debtSave: number | null
  savingsSave: number | null
  netWorthPrepay: number | null
  netWorthSave: number | null
}

/** Точка анализа слёта на абсолютной оси */
export interface SlipTimelinePoint {
  month: number
  paymentWithPrepay: number
  paymentWithoutPrepay: number
}

export interface Timeline {
  /** false — гостевой сценарий: история отсутствует, ось совпадает с series */
  hasHistory: boolean
  /** Абсолютный месяц «сегодня» = длина истории − 1 (0 без истории) */
  todayMonth: number
  points: TimelinePoint[]
  slipPoints: SlipTimelinePoint[]
  /** 'YYYY-MM-DD' даты выдачи; null без истории */
  startedOn: string | null
}

/** Индекс календарного месяца: year*12 + (month-1) — та же арифметика, что в tracker.ts */
function monthKeyFromDate(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return y * 12 + (m - 1)
}

function formatMonthKey(key: number): string {
  const y = Math.floor(key / 12)
  const m = key - y * 12 + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * Склеивает историю долга (факт по трекеру) и прогноз (`result.series`) в единый ряд
 * на оси «месяц от выдачи ипотеки». Правила склейки — §2.3 дизайна:
 * - длина `points` = `todayMonth + horizonMonths + 1`;
 * - `month < todayMonth`: заполнены только `debtFact`/`netWorthFact`;
 * - `month > todayMonth`: заполнены только прогнозные ключи;
 * - `month === todayMonth`: заполнены все ключи (точка стыка, линии сходятся).
 *
 * `history` — компактный ряд остатков по месяцам от выдачи (см. `LinkedMortgage.history`).
 * `history === null` — гостевой сценарий: `todayMonth = 0`, точка стыка (month 0) всё равно
 * заполняется фактом — он равен `series[0].debtSave` (стратегия «копить» не дампит долг
 * в месяц 0, поэтому это тот же «текущий долг», что и в любом другом случае).
 */
export function buildTimeline(result: CalculationResult, history: number[] | null, startedOn: string | null): Timeline {
  const hasHistory = history !== null && history.length > 0
  const todayMonth = hasHistory ? history.length - 1 : 0
  const horizonMonths = result.series.length - 1
  const totalMonths = todayMonth + horizonMonths + 1

  const points: TimelinePoint[] = new Array(totalMonths)

  for (let month = 0; month < totalMonths; month++) {
    let debtFact: number | null = null
    if (hasHistory && month <= todayMonth) {
      debtFact = history[month]
    } else if (month === todayMonth) {
      // Гостевой сценарий: точка стыка (month 0) заполняется фактом даже без истории —
      // «сейчас» и есть момент выдачи, факт и начало прогноза — одно и то же число.
      debtFact = result.series[0].debtSave
    }
    const netWorthFact = debtFact !== null ? -debtFact : null

    let debtPrepay: number | null = null
    let debtSave: number | null = null
    let savingsSave: number | null = null
    let netWorthPrepay: number | null = null
    let netWorthSave: number | null = null
    if (month >= todayMonth) {
      const p = result.series[month - todayMonth]
      debtPrepay = p.debtPrepay
      debtSave = p.debtSave
      savingsSave = p.savingsSave
      netWorthPrepay = p.netWorthPrepay
      netWorthSave = p.netWorthSave
    }

    points[month] = { month, debtFact, netWorthFact, debtPrepay, debtSave, savingsSave, netWorthPrepay, netWorthSave }
  }

  const slipPoints: SlipTimelinePoint[] = result.slipAnalysis.map((p) => ({
    month: todayMonth + p.slipMonth,
    paymentWithPrepay: p.paymentWithPrepay,
    paymentWithoutPrepay: p.paymentWithoutPrepay,
  }))

  return {
    hasHistory,
    todayMonth,
    points,
    slipPoints,
    startedOn: hasHistory ? startedOn : null,
  }
}

/** Месяц-от-сегодня (единицы движка) → абсолютный месяц оси таймлайна */
export function toAbsolute(t: Timeline, monthFromToday: number): number {
  return t.todayMonth + monthFromToday
}

/** Точки от «сегодня» и дальше — для режима графика «От сегодня» (§1.7 дизайна) */
export function sliceFromToday(t: Timeline): TimelinePoint[] {
  return t.points.slice(t.todayMonth)
}

/** 'YYYY-MM' для абсолютного месяца оси; null без истории (нет даты выдачи, от которой считать) */
export function absoluteMonthLabel(t: Timeline, month: number): string | null {
  if (!t.hasHistory || t.startedOn === null) return null
  const startKey = monthKeyFromDate(t.startedOn)
  return formatMonthKey(startKey + month)
}
