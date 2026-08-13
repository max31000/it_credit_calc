/**
 * Отчётность «движение денег» и «вычеты по годам» (§2.4, §6.2, §7.3 спеки
 * docs/specs/2026-08-14-continuous-simulation-design.md). Чистый модуль: без React,
 * без `new Date()`. Читает только уже посчитанные `CalculationResult` и `MortgageFact` —
 * никакой собственной симуляции.
 */
import type { CalculationResult, MortgageParams } from './engine'
import type { MortgageFact } from './tracker'

export type YearKind = 'fact' | 'mixed' | 'forecast'

export interface CashFlowYear {
  /** Календарный год в режиме ипотеки; порядковый год прогноза (1…N) у гостя */
  year: number
  kind: YearKind
  /** Проценты за год, ₽ */
  interest: number
  /** Тело, погашенное обязательными платежами, ₽ */
  principal: number
  /** Досрочные погашения (у прогноза — всё, что внесено сверх обязательного платежа), ₽ */
  prepayment: number
  /** interest + principal + prepayment */
  total: number
}

export type DeductionStatus = 'claimed' | 'partial' | 'forecast' | 'noBase'

export interface DeductionYear {
  year: number
  kind: YearKind
  /** Проценты, уплаченные за этот год (факт и/или прогноз), ₽ */
  interestPaid: number
  status: DeductionStatus
  /** Возврат за год: прошлое — оценка по израсходованной базе, будущее — из TaxInfo, ₽ */
  refund: number
  /** Имущественная часть возврата (только прогнозные строки), ₽ */
  propertyRefund: number
}

export interface DeductionReport {
  rows: DeductionYear[]
  /**
   * Последний календарный год, проценты по который полностью укладываются
   * в `params.usedInterestBase`. null — база не введена или факта нет.
   * ВЫВОДИТСЯ, не хранится (см. §6.2).
   */
  claimedThroughYear: number | null
  /** Остаток базы имущественного вычета на сегодня, ₽ (= result.tax.propertyBaseStart) */
  propertyBaseLeft: number
  /** Остаток базы вычета по процентам на сегодня, ₽ */
  interestBaseLeft: number
}

/**
 * Календарный год месяца `t` прогноза (t ≥ 1, месяцев от «сегодня»). Та же арифметика,
 * что в `engine.settleTaxYear` (§3.3 спеки): месяц «сегодня» имеет номер `12 − taxSettleOffset`
 * внутри своего календарного года.
 */
function calendarYearForMonth(fact: MortgageFact, t: number): number {
  const todayMonthOfYear = 12 - fact.engine.taxSettleOffset // 1..12
  return fact.engine.currentYear + Math.floor((todayMonthOfYear - 1 + t) / 12)
}

/** Календарный (при факте) или порядковый (у гостя) год месяца t ≥ 1 прогноза */
function forecastYear(fact: MortgageFact | null, t: number): number {
  return fact ? calendarYearForMonth(fact, t) : Math.ceil(t / 12)
}

/**
 * Движение денег по годам: факт-фаза из `fact.history`, прогноз — из `result.series`
 * выбранной стратегии. Месячный платёж прогноза восстанавливается как
 * `interest + (debt[t−1] − debt[t])` — движку не нужны дополнительные поля для этого.
 */
export function buildCashFlow(
  result: CalculationResult,
  fact: MortgageFact | null,
  strategy: 'prepay' | 'save',
): CashFlowYear[] {
  interface Bucket {
    interest: number
    principal: number
    prepayment: number
    kind: YearKind
  }
  const buckets = new Map<number, Bucket>()

  // Факт-фаза: календарные годы, kind 'fact' (кроме месяца 0 — там нет движения денег)
  if (fact) {
    for (let s = 1; s <= fact.elapsedMonths; s++) {
      const point = fact.history.points[s]
      const year = Number(point.yearMonth.split('-')[0])
      const bucket = buckets.get(year) ?? { interest: 0, principal: 0, prepayment: 0, kind: 'fact' as YearKind }
      bucket.interest += point.interest
      bucket.principal += point.principalPaid
      bucket.prepayment += point.prepayment
      buckets.set(year, bucket)
    }
  }

  // Прогноз-фаза
  const debtKey = strategy === 'prepay' ? ('debtPrepay' as const) : ('debtSave' as const)
  const paymentKey = strategy === 'prepay' ? ('paymentPrepay' as const) : ('paymentSave' as const)
  const interestKey = strategy === 'prepay' ? ('interestPrepay' as const) : ('interestSave' as const)

  const horizonMonths = result.series.length - 1
  for (let t = 1; t <= horizonMonths; t++) {
    const interest = result.series[t][interestKey]
    const paid = interest + (result.series[t - 1][debtKey] - result.series[t][debtKey])
    // «Обязательный платёж» — эталон для отделения досрочки. Берётся из ПРЕДЫДУЩЕЙ точки:
    // `SimPoint.payment` — это аннуитет, действующий в СЛЕДУЮЩЕМ месяце, поэтому платёж,
    // фактически внесённый в месяце t, задан `series[t − 1].payment<Strategy>`. Для save
    // разницы почти нет (аннуитет не меняется вне слёта/вычетов), а для prepay, где аннуитет
    // пересчитывается ежемесячно, series[t] занижает эталон и часть тела уезжает в «досрочки».
    const mandatory = result.series[t - 1][paymentKey]
    const prepayment = Math.max(0, paid - mandatory)
    const principal = paid - interest - prepayment

    const year = forecastYear(fact, t)
    const existing = buckets.get(year)
    const kind: YearKind = existing ? (existing.kind === 'fact' ? 'mixed' : existing.kind) : 'forecast'
    const bucket: Bucket = existing ?? { interest: 0, principal: 0, prepayment: 0, kind }
    bucket.kind = kind
    bucket.interest += interest
    bucket.principal += principal
    bucket.prepayment += prepayment
    buckets.set(year, bucket)
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, b]) => ({
      year,
      kind: b.kind,
      interest: Math.round(b.interest),
      principal: Math.round(b.principal),
      prepayment: Math.round(b.prepayment),
      total: Math.round(b.interest + b.principal + b.prepayment),
    }))
}

/**
 * Таблица вычетов по годам (§6.2 спеки): прошлые годы — статус по нарастающему итогу
 * фактических процентов против `usedInterestBase`; год стыка и будущее — из `result.tax.byYear`
 * (движок уже перенёс незаявленные проценты факт-фазы в пул первого года прогноза, §3.3, §6.3).
 * `null` при `params.salary === null` (налоговые вычеты не считаются вовсе).
 */
export function buildDeductionReport(
  result: CalculationResult,
  fact: MortgageFact | null,
  params: MortgageParams,
): DeductionReport | null {
  if (params.salary === null || result.tax === null) return null

  const tax = result.tax
  const ndflRate = tax.ndflRate

  // Годы, уже представленные в прогнозе движка (календарные при факте, порядковые у гостя)
  const forecastYears = new Map<number, { amount: number; propertyReturn: number }>()
  for (const row of tax.byYear) {
    const year = row.calendarYear ?? row.year
    forecastYears.set(year, { amount: row.amount, propertyReturn: row.propertyReturn })
  }

  const rows: DeductionYear[] = []
  let claimedThroughYear: number | null = null

  // Прошлые годы, ПОЛНОСТЬЮ вне прогноза (не задеты движком) — статус по нарастающему итогу
  if (fact) {
    const pastOnlyYears = Object.keys(fact.history.interestByYear)
      .map(Number)
      .filter((y) => !forecastYears.has(y))
      .sort((a, b) => a - b)

    let cum = 0
    for (const year of pastOnlyYears) {
      const interestPaid = fact.history.interestByYear[year] ?? 0
      const prevCum = cum
      cum += interestPaid

      let status: DeductionStatus
      let claimablePortion = 0
      if (interestPaid <= 0) {
        status = 'noBase'
      } else if (cum <= params.usedInterestBase) {
        status = 'claimed'
        claimedThroughYear = year
        claimablePortion = interestPaid
      } else if (prevCum < params.usedInterestBase) {
        status = 'partial'
        claimablePortion = Math.max(0, params.usedInterestBase - prevCum)
      } else {
        status = 'forecast' // ещё можно заявить
        claimablePortion = interestPaid
      }

      rows.push({
        year,
        kind: 'fact',
        interestPaid: Math.round(interestPaid),
        status,
        refund: Math.round(claimablePortion * ndflRate),
        propertyRefund: 0,
      })
    }
  }

  // Год стыка (mixed) и прогноз (forecast) — из движка
  const sortedForecastYears = [...forecastYears.keys()].sort((a, b) => a - b)
  for (const year of sortedForecastYears) {
    const factInterest = fact ? (fact.history.interestByYear[year] ?? 0) : 0
    const forecastInterest = forecastYearInterest(result, fact, year)
    const interestPaid = factInterest + forecastInterest
    const { amount, propertyReturn } = forecastYears.get(year)!
    const kind: YearKind = factInterest > 0 ? 'mixed' : 'forecast'
    const status: DeductionStatus = amount > 0 ? 'forecast' : 'noBase'

    rows.push({
      year,
      kind,
      interestPaid: Math.round(interestPaid),
      status,
      refund: Math.round(amount),
      propertyRefund: Math.round(propertyReturn),
    })
  }

  rows.sort((a, b) => a.year - b.year)

  return {
    rows,
    claimedThroughYear,
    propertyBaseLeft: tax.propertyBaseStart,
    interestBaseLeft: tax.interestBaseStart,
  }
}

/** Сумма process interestSave/interestPrepay (стратегия «копить» — та же, что даёт TaxInfo)
 *  за месяцы прогноза, попадающие в календарный (или порядковый у гостя) год `year`. */
function forecastYearInterest(result: CalculationResult, fact: MortgageFact | null, year: number): number {
  const horizonMonths = result.series.length - 1
  let sum = 0
  for (let t = 1; t <= horizonMonths; t++) {
    if (forecastYear(fact, t) === year) sum += result.series[t].interestSave
  }
  return sum
}
