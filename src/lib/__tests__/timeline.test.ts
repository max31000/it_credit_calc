import { describe, it, expect } from 'vitest'
import { buildTimeline, toAbsolute, sliceFromToday, absoluteMonthLabel } from '../timeline'
import { calculate } from '../engine'
import type { MortgageParams, CalculationResult } from '../engine'

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

describe('buildTimeline', () => {
  it('history === null: hasHistory false, todayMonth 0, длина points === horizonMonths + 1', () => {
    const r = result()
    const t = buildTimeline(r, null, null)

    expect(t.hasHistory).toBe(false)
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

  it('история длины 61 → todayMonth === 60, points.length === 60 + horizonMonths + 1', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, history, '2021-01-01')

    expect(t.hasHistory).toBe(true)
    expect(t.todayMonth).toBe(60)
    expect(t.points.length).toBe(60 + r.series.length)
  })

  it('в точке todayMonth заполнены все ключи; todayMonth−1 — только факт; todayMonth+1 — только прогноз', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, history, '2021-01-01')

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
    const t = buildTimeline(r, history, '2021-01-01')

    expect(t.slipPoints[0].month).toBe(t.todayMonth + 1)
  })

  it('toAbsolute(t, 0) === todayMonth', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, history, '2021-01-01')

    expect(toAbsolute(t, 0)).toBe(t.todayMonth)
    expect(toAbsolute(t, 5)).toBe(t.todayMonth + 5)
  })

  it('sliceFromToday(t)[0].month === todayMonth', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, history, '2021-01-01')

    const sliced = sliceFromToday(t)
    expect(sliced[0].month).toBe(t.todayMonth)
    expect(sliced.length).toBe(t.points.length - t.todayMonth)
  })

  it('absoluteMonthLabel: корректный YYYY-MM с историей, null без истории', () => {
    const r = result()
    const history = Array.from({ length: 61 }, (_, i) => 5_500_000 - i * 5_000)
    const t = buildTimeline(r, history, '2021-01-01')

    expect(absoluteMonthLabel(t, 0)).toBe('2021-01')
    expect(absoluteMonthLabel(t, 13)).toBe('2022-02')

    const guest = buildTimeline(r, null, null)
    expect(absoluteMonthLabel(guest, 0)).toBeNull()
  })
})
