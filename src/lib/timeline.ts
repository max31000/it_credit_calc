/**
 * Presentation-слой «факт + прогноз» для графиков (§2.3 спеки
 * docs/specs/2026-08-14-continuous-simulation-design.md). Чистый модуль: без React,
 * без `new Date()`. Использует только типы `tracker.ts` (обратной стрелки engine → tracker нет
 * и не будет).
 *
 * Движок (`engine.ts`) не знает про даты и время до «сегодня» — его `series[0]` всегда
 * «начало прогноза». Этот модуль склеивает прошлое (`MortgageFact.history`) и будущее
 * (`series`) в единую ось «месяц от выдачи ипотеки».
 */
import type { CalculationResult } from './engine'
import type { MortgageFact } from './tracker'
import type { MortgageEventKind } from '../api/types'

/** Одна точка склеенного ряда: абсолютный месяц от выдачи ипотеки */
export interface TimelinePoint {
  /** Абсолютный месяц: 0 — выдача ипотеки (в гостевом сценарии совпадает с «сегодня») */
  month: number
  /** Факт по трекеру; null для месяцев после «сегодня» */
  debtFact: number | null
  /** −debtFact — нижняя граница капитала в прошлом; null после «сегодня» */
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

/** Маркер события факт-фазы для ReferenceDot/ReferenceLine — только prepayment и rate */
export interface TimelineMarker {
  month: number
  kind: MortgageEventKind
  amount: number | null
  rate: number | null
  yearMonth: string
}

export interface Timeline {
  /** false — гостевой сценарий: факта нет, ось совпадает с series */
  hasFact: boolean
  /** Абсолютный месяц «сегодня» = fact.elapsedMonths (0 без факта) */
  todayMonth: number
  points: TimelinePoint[]
  slipPoints: SlipTimelinePoint[]
  /** 'YYYY-MM-DD' даты выдачи; null без факта */
  startedOn: string | null
  /** Маркеры событий прошлого — только prepayment и rate (снимки и смены платежа не рисуем) */
  markers: TimelineMarker[]
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
 * Склеивает факт-фазу (`MortgageFact.history`) и прогноз (`result.series`) в единый ряд
 * на оси «месяц от выдачи ипотеки». Правила склейки не меняются относительно фазы 5:
 * - длина `points` = `todayMonth + horizonMonths + 1`;
 * - `month < todayMonth`: заполнены только `debtFact`/`netWorthFact`;
 * - `month > todayMonth`: заполнены только прогнозные ключи;
 * - `month === todayMonth`: заполнены все ключи (точка стыка, линии сходятся).
 *
 * `fact === null` — гостевой сценарий: `todayMonth = 0`, точка стыка (month 0) всё равно
 * заполняется фактом — он равен `series[0].debtSave` (стратегия «копить» не дампит долг
 * в месяц 0, поэтому это тот же «текущий долг», что и в любом другом случае).
 */
export function buildTimeline(result: CalculationResult, fact: MortgageFact | null): Timeline {
  const hasFact = fact !== null
  const todayMonth = hasFact ? fact.elapsedMonths : 0
  const horizonMonths = result.series.length - 1
  const totalMonths = todayMonth + horizonMonths + 1

  const points: TimelinePoint[] = new Array(totalMonths)

  for (let month = 0; month < totalMonths; month++) {
    let debtFact: number | null = null
    if (hasFact && month <= todayMonth) {
      debtFact = fact.history.points[month].debt
    } else if (month === todayMonth) {
      // Гостевой сценарий: точка стыка (month 0) заполняется фактом даже без факт-фазы —
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

  const markers: TimelineMarker[] = hasFact
    ? fact.events
        .filter((e) => e.kind === 'prepayment' || e.kind === 'rate')
        .map((e) => ({ month: e.month, kind: e.kind, amount: e.amount, rate: e.rate, yearMonth: e.yearMonth }))
    : []

  return {
    hasFact,
    todayMonth,
    points,
    slipPoints,
    startedOn: hasFact ? fact.startedOn : null,
    markers,
  }
}

/** Месяц-от-сегодня (единицы движка) → абсолютный месяц оси таймлайна */
export function toAbsolute(t: Timeline, monthFromToday: number): number {
  return t.todayMonth + monthFromToday
}

/** Точки от «сегодня» и дальше — для режима графика «От сегодня» */
export function sliceFromToday(t: Timeline): TimelinePoint[] {
  return t.points.slice(t.todayMonth)
}

/** 'YYYY-MM' для абсолютного месяца оси; null без факта (нет даты выдачи, от которой считать) */
export function absoluteMonthLabel(t: Timeline, month: number): string | null {
  if (!t.hasFact || t.startedOn === null) return null
  const startKey = monthKeyFromDate(t.startedOn)
  return formatMonthKey(startKey + month)
}
