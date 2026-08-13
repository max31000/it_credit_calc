import { describe, it, expect } from 'vitest'
import { buildCashFlow, buildDeductionReport } from '../reporting'
import { calculate } from '../engine'
import { buildMortgageFact } from '../tracker'
import type { MortgageParams } from '../engine'
import type { MortgageDto, MortgageEventDto } from '../../api/types'

const guestParams = (): MortgageParams => ({
  apartmentPrice: 7_000_000,
  downPayment: 1_500_000,
  itRate: 6,
  termYears: 20,
  freeMonthly: 100_000,
  depositRate: 16,
  horizonYears: 10,
  slipMonth: 0,
  keyRate: 16,
  bankDiscount: 0.5,
  salary: null,
  startingSavings: 0,
  usedPropertyBase: 0,
  usedInterestBase: 0,
})

const trackerMortgage = (over: Partial<MortgageDto> = {}): MortgageDto => ({
  id: 1,
  title: 'Квартира на Ленина',
  bank: 'Сбер',
  propertyPrice: 7_000_000,
  downPayment: 1_500_000,
  principal: 5_500_000,
  rate: 6,
  termMonths: 240,
  startedOn: '2020-01-01',
  monthlyPayment: null,
  usedPropertyBase: 0,
  usedInterestBase: 0,
  createdAt: '2020-01-01T00:00:00Z',
  updatedAt: '2020-01-01T00:00:00Z',
  ...over,
})

let nextId = 1
const ev = (partial: Partial<MortgageEventDto>): MortgageEventDto => ({
  id: nextId++,
  mortgageId: 1,
  kind: 'balance',
  occurredOn: '2020-01-01',
  amount: null,
  rate: null,
  note: null,
  createdAt: '2020-01-01T00:00:00Z',
  ...partial,
})

// ─── buildCashFlow ──────────────────────────────────────────────────────────
describe('buildCashFlow', () => {
  it('гость (fact = null): только прогнозные строки с порядковыми годами 1…N, kind forecast', () => {
    const result = calculate({ ...guestParams(), horizonYears: 3 })
    const rows = buildCashFlow(result, null, 'save')

    expect(rows.map((r) => r.year)).toEqual([1, 2, 3])
    expect(rows.every((r) => r.kind === 'forecast')).toBe(true)
  })

  it('И13: без стыка (taxSettleOffset === 0) — Σ по фактическим годам === fact.history.paidTotal/paidInterest (допуск 1 ₽)', () => {
    const m = trackerMortgage()
    const today = new Date('2025-12-31') // offset === 0 → нет частичного года стыка
    const fact = buildMortgageFact(m, [ev({ kind: 'prepayment', occurredOn: '2022-06-01', amount: 300_000 })], today)
    expect(fact.engine.taxSettleOffset).toBe(0)

    const result = calculate({ ...guestParams(), slipMonth: 0 }, fact.engine)
    const rows = buildCashFlow(result, fact, 'save')

    const factRows = rows.filter((r) => r.kind === 'fact')
    expect(factRows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.kind === 'mixed')).toBe(false)

    const sumTotal = factRows.reduce((s, r) => s + r.total, 0)
    const sumInterest = factRows.reduce((s, r) => s + r.interest, 0)
    expect(Math.abs(sumTotal - fact.history.paidTotal)).toBeLessThanOrEqual(1)
    expect(Math.abs(sumInterest - fact.history.paidInterest)).toBeLessThanOrEqual(1)
  })

  it('год стыка помечен mixed при offset > 0', () => {
    const m = trackerMortgage()
    const today = new Date('2026-08-13') // offset === 4 → currentYear ещё не закрыт
    const fact = buildMortgageFact(m, [], today)
    expect(fact.engine.taxSettleOffset).toBeGreaterThan(0)

    const result = calculate({ ...guestParams(), slipMonth: 0 }, fact.engine)
    const rows = buildCashFlow(result, fact, 'save')

    const mixedRows = rows.filter((r) => r.kind === 'mixed')
    expect(mixedRows.length).toBe(1)
    expect(mixedRows[0].year).toBe(fact.engine.currentYear)
  })

  it('видимые частичные закрытия: досрочка факт-фазы попадает в prepayment соответствующего года', () => {
    const m = trackerMortgage()
    const today = new Date('2025-12-31')
    const fact = buildMortgageFact(m, [ev({ kind: 'prepayment', occurredOn: '2022-06-01', amount: 300_000 })], today)
    const result = calculate({ ...guestParams(), slipMonth: 0 }, fact.engine)
    const rows = buildCashFlow(result, fact, 'save')

    const row2022 = rows.find((r) => r.year === 2022)
    expect(row2022).toBeDefined()
    expect(row2022!.prepayment).toBeCloseTo(300_000, 0)
  })
})

// ─── buildDeductionReport ───────────────────────────────────────────────────
describe('buildDeductionReport', () => {
  it('salary === null → null', () => {
    const result = calculate({ ...guestParams(), salary: null })
    expect(buildDeductionReport(result, null, { ...guestParams(), salary: null })).toBeNull()
  })

  it('гость (fact = null): только прогнозные строки', () => {
    const params: MortgageParams = { ...guestParams(), salary: 300_000, horizonYears: 3 }
    const result = calculate(params)
    const report = buildDeductionReport(result, null, params)

    expect(report).not.toBeNull()
    expect(report!.rows.every((r) => r.kind === 'forecast')).toBe(true)
    expect(report!.rows.map((r) => r.year)).toEqual([1, 2, 3])
  })

  it('И14: claimedThroughYear после round-trip хелпера usedInterestBase = min(3e6, cum(N)) равен N', () => {
    const m = trackerMortgage()
    const today = new Date('2026-06-15') // offset > 0, несколько полных прошлых лет
    const fact = buildMortgageFact(m, [], today)

    const cum = (year: number): number =>
      Object.entries(fact.history.interestByYear)
        .filter(([y]) => Number(y) <= year)
        .reduce((s, [, v]) => s + v, 0)

    const targetYear = 2023
    const usedInterestBase = Math.min(3_000_000, cum(targetYear))

    const params: MortgageParams = { ...guestParams(), slipMonth: 0, salary: 300_000, usedInterestBase }
    const result = calculate(params, fact.engine)
    const report = buildDeductionReport(result, fact, params)

    expect(report).not.toBeNull()
    expect(report!.claimedThroughYear).toBe(targetYear)
  })

  it('usedInterestBase > paidInterest → все прошлые (не стыковые) годы claimed', () => {
    const m = trackerMortgage()
    const today = new Date('2025-12-31') // offset === 0, нет строки mixed
    const fact = buildMortgageFact(m, [], today)

    const params: MortgageParams = {
      ...guestParams(),
      slipMonth: 0,
      salary: 300_000,
      usedInterestBase: fact.history.paidInterest + 1_000_000,
    }
    const result = calculate(params, fact.engine)
    const report = buildDeductionReport(result, fact, params)

    expect(report).not.toBeNull()
    const factRows = report!.rows.filter((r) => r.kind === 'fact')
    expect(factRows.length).toBeGreaterThan(0)
    expect(factRows.every((r) => r.status === 'claimed' || r.interestPaid === 0)).toBe(true)
  })

  it('год стыка помечен mixed и содержит и факт, и прогноз', () => {
    const m = trackerMortgage()
    const today = new Date('2026-08-13')
    const fact = buildMortgageFact(m, [], today)
    const params: MortgageParams = { ...guestParams(), slipMonth: 0, salary: 300_000 }
    const result = calculate(params, fact.engine)
    const report = buildDeductionReport(result, fact, params)

    const mixedRow = report!.rows.find((r) => r.kind === 'mixed')
    expect(mixedRow).toBeDefined()
    expect(mixedRow!.year).toBe(fact.engine.currentYear)
    expect(mixedRow!.interestPaid).toBeGreaterThan(fact.history.interestByYear[fact.engine.currentYear] ?? 0)
  })
})
