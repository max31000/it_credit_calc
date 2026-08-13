import { describe, it, expect } from 'vitest'
import { buildTimeline, toAbsolute, sliceFromToday, absoluteMonthLabel } from '../timeline'
import { calculate } from '../engine'
import { buildMortgageFact, computeMortgageState } from '../tracker'
import type { MortgageParams, CalculationResult } from '../engine'
import type { MortgageFact, DebtHistory } from '../tracker'
import type { MortgageDto, MortgageEventDto } from '../../api/types'

const params = (): MortgageParams => ({
  apartmentPrice: 7_000_000,
  downPayment: 1_500_000,
  itRate: 6,
  termYears: 20,
  freeMonthly: 100_000,
  depositRate: 16,
  horizonYears: 10,
  slipMonth: 24,
  keyRate: 16,
  bankDiscount: 0.5,
  salary: null,
  startingSavings: 0,
  usedPropertyBase: 0,
  usedInterestBase: 0,
})

const result = (): CalculationResult => calculate(params())

/**
 * Собирает минимальный `MortgageFact` из компактного ряда остатков — эквивалент старого
 * `history: number[]` из фазы 5, только сигнатура `buildTimeline` теперь принимает факт целиком.
 * Используется для тестов, которые проверяют только механику склейки (не значения движка).
 */
function mockFact(debts: number[], startedOn: string): MortgageFact {
  const elapsedMonths = debts.length - 1
  const points: DebtHistory['points'] = debts.map((debt, i) => ({
    month: i,
    yearMonth: '2021-01',
    debt,
    interest: 0,
    scheduledPaid: 0,
    principalPaid: 0,
    prepayment: 0,
    snapshotAdjustment: 0,
    rate: 6,
    payment: 30_000,
  }))
  const history: DebtHistory = {
    points,
    elapsedMonths,
    paidInterest: 0,
    interestByYear: {},
    paidScheduled: 0,
    paidPrepayments: 0,
    paidTotal: 0,
    principalRepaid: 0,
    snapshotDrift: 0,
    hasSnapshots: false,
  }
  return {
    engine: {
      debt: debts[debts.length - 1],
      rate: 6,
      payment: 30_000,
      remainingMonths: 120,
      paidInterest: 0,
      paidTotal: 0,
      taxSettleOffset: 12,
      currentYear: 2026,
    },
    principal: debts[0],
    propertyPrice: 7_000_000,
    downPayment: 1_500_000,
    originalRate: 6,
    termMonths: 240,
    startedOn,
    elapsedMonths,
    history,
    events: [],
    paymentCoversInterest: true,
    termExpired: false,
  }
}

describe('buildTimeline', () => {
  it('fact === null: hasFact false, todayMonth 0, длина points === horizonMonths + 1', () => {
    const r = result()
    const t = buildTimeline(r, null)

    expect(t.hasFact).toBe(false)
    expect(t.todayMonth).toBe(0)
    expect(t.points.length).toBe(r.series.length) // horizonMonths + 1
    expect(t.startedOn).toBeNull()

    // прогнозные ключи заполнены везде
    for (const p of t.points) {
      expect(p.debtPrepay).not.toBeNull()
      expect(p.debtSave).not.toBeNull()
      expect(p.netWorthPrepay).not.toBeNull()
      expect(p.netWorthSave).not.toBeNull()
    }

    // debtFact заполнен только в month === 0
    expect(t.points[0].debtFact).not.toBeNull()
    for (let i = 1; i < t.points.length; i++) {
      expect(t.points[i].debtFact).toBeNull()
      expect(t.points[i].netWorthFact).toBeNull()
    }
  })

  it('факт с 61 точкой → todayMonth === 60, points.length === 60 + horizonMonths + 1', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, mockFact(history, '2021-01-01'))

    expect(t.hasFact).toBe(true)
    expect(t.todayMonth).toBe(60)
    expect(t.points.length).toBe(60 + r.series.length)
  })

  it('в точке todayMonth заполнены все ключи; todayMonth−1 — только факт; todayMonth+1 — только прогноз', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, mockFact(history, '2021-01-01'))

    const joint = t.points[t.todayMonth]
    expect(joint.debtFact).not.toBeNull()
    expect(joint.debtPrepay).not.toBeNull()
    expect(joint.debtSave).not.toBeNull()
    expect(joint.netWorthPrepay).not.toBeNull()
    expect(joint.netWorthSave).not.toBeNull()

    const past = t.points[t.todayMonth - 1]
    expect(past.debtFact).not.toBeNull()
    expect(past.debtPrepay).toBeNull()
    expect(past.debtSave).toBeNull()

    const future = t.points[t.todayMonth + 1]
    expect(future.debtFact).toBeNull()
    expect(future.netWorthFact).toBeNull()
    expect(future.debtPrepay).not.toBeNull()
  })

  it('slipPoints[0].month === todayMonth + 1', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, mockFact(history, '2021-01-01'))

    expect(t.slipPoints[0].month).toBe(t.todayMonth + 1)
  })

  it('toAbsolute(t, 0) === todayMonth', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, mockFact(history, '2021-01-01'))

    expect(toAbsolute(t, 0)).toBe(t.todayMonth)
    expect(toAbsolute(t, 5)).toBe(t.todayMonth + 5)
  })

  it('sliceFromToday(t)[0].month === todayMonth', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, mockFact(history, '2021-01-01'))

    const sliced = sliceFromToday(t)
    expect(sliced[0].month).toBe(t.todayMonth)
    expect(sliced.length).toBe(t.points.length - t.todayMonth)
  })

  it('absoluteMonthLabel: корректный YYYY-MM с фактом, null без факта', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, mockFact(history, '2021-01-01'))

    expect(absoluteMonthLabel(t, 0)).toBe('2021-01')
    expect(absoluteMonthLabel(t, 13)).toBe('2022-02')

    const guest = buildTimeline(r, null)
    expect(absoluteMonthLabel(guest, 0)).toBeNull()
  })
})

// ─── Инварианты §11 спеки docs/specs/2026-08-14-continuous-simulation-design.md ────────────
describe('инварианты непрерывности (реальный факт из трекера)', () => {
  const trackerMortgage = (): MortgageDto => ({
    id: 1,
    title: 'Квартира на Ленина',
    bank: 'Сбер',
    propertyPrice: 7_000_000,
    downPayment: 1_500_000,
    principal: 5_500_000,
    rate: 6,
    termMonths: 240,
    startedOn: '2021-01-01',
    monthlyPayment: null,
    usedPropertyBase: 0,
    usedInterestBase: 0,
    createdAt: '2021-01-01T00:00:00Z',
    updatedAt: '2021-01-01T00:00:00Z',
  })

  let nextId = 1
  const ev = (partial: Partial<MortgageEventDto>): MortgageEventDto => ({
    id: nextId++,
    mortgageId: 1,
    kind: 'balance',
    occurredOn: '2021-01-01',
    amount: null,
    rate: null,
    note: null,
    createdAt: '2021-01-01T00:00:00Z',
    ...partial,
  })

  const today = new Date('2026-01-01') // 60 месяцев с startedOn

  it('И3: непрерывность долга — timeline, series[0], fact.engine.debt и state.currentBalance согласованы', () => {
    const m = trackerMortgage()
    const events = [ev({ kind: 'prepayment', occurredOn: '2023-06-01', amount: 300_000 })]
    const fact = buildMortgageFact(m, events, today)
    const state = computeMortgageState(m, events, today)
    const r = calculate(params(), fact.engine)
    const t = buildTimeline(r, fact)

    const atToday = t.points[t.todayMonth]
    expect(atToday.debtFact).not.toBeNull()
    const rounded = Math.round(atToday.debtFact as number)
    expect(rounded).toBe(r.series[0].debtSave)
    expect(rounded).toBe(Math.round(fact.engine.debt))
    expect(rounded).toBe(Math.round(state.currentBalance))
  })

  it('И4: непрерывность капитала — ступенька на «Сегодня» равна ровно startingSavings', () => {
    const m = trackerMortgage()
    const fact = buildMortgageFact(m, [], today)
    const p: MortgageParams = { ...params(), startingSavings: 250_000 }
    const r = calculate(p, fact.engine)
    const t = buildTimeline(r, fact)

    const atToday = t.points[t.todayMonth]
    const step = r.series[0].netWorthSave - (atToday.netWorthFact as number)
    expect(step).toBeCloseTo(p.startingSavings, 0)
  })

  it('И15: buildTimeline(result, null) — hasFact false, todayMonth 0, длина points === horizonMonths + 1, markers === []', () => {
    const r = result()
    const t = buildTimeline(r, null)
    expect(t.hasFact).toBe(false)
    expect(t.todayMonth).toBe(0)
    expect(t.points.length).toBe(r.series.length)
    expect(t.markers).toEqual([])
  })

  it('markers содержат только prepayment и rate — снимки и смены платежа не рисуются', () => {
    const m = trackerMortgage()
    const events = [
      ev({ kind: 'prepayment', occurredOn: '2022-03-01', amount: 300_000 }),
      ev({ kind: 'rate', occurredOn: '2023-07-01', rate: 8, amount: null }),
      ev({ kind: 'balance', occurredOn: '2024-01-01', amount: 4_500_000 }),
      ev({ kind: 'payment', occurredOn: '2024-06-01', amount: 45_000 }),
    ]
    const fact = buildMortgageFact(m, events, today)
    const r = calculate(params(), fact.engine)
    const t = buildTimeline(r, fact)

    expect(t.markers.length).toBe(2)
    expect(t.markers.every((mk) => mk.kind === 'prepayment' || mk.kind === 'rate')).toBe(true)
    expect(t.markers.some((mk) => mk.kind === 'prepayment')).toBe(true)
    expect(t.markers.some((mk) => mk.kind === 'rate')).toBe(true)
  })
})
