import { describe, it, expect } from 'vitest'
import { computeMortgageState } from '../tracker'
import { calcPMT } from '../engine'
import type { MortgageDto, MortgageEventDto } from '../../api/types'

const baseMortgage = (): MortgageDto => ({
  id: 1,
  title: 'Квартира на Ленина',
  bank: 'Сбер',
  propertyPrice: 7_000_000,
  downPayment: 1_500_000,
  principal: 5_500_000,
  rate: 6,
  termMonths: 240,
  startedOn: '2025-01-01',
  monthlyPayment: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
})

let nextId = 1
const ev = (partial: Partial<MortgageEventDto>): MortgageEventDto => ({
  id: nextId++,
  mortgageId: 1,
  kind: 'balance',
  occurredOn: '2025-01-01',
  amount: null,
  rate: null,
  note: null,
  createdAt: '2025-01-01T00:00:00Z',
  ...partial,
})

describe('computeMortgageState', () => {
  it('без событий остаток совпадает с аннуитетной формулой на N месяцев', () => {
    const m = baseMortgage()
    const today = new Date('2026-01-01') // 12 месяцев с startedOn

    const pmt = calcPMT(m.principal, m.rate / 1200, m.termMonths)
    let expectedBalance = m.principal
    const r = m.rate / 1200
    for (let i = 0; i < 12; i++) {
      const interest = expectedBalance * r
      expectedBalance = expectedBalance + interest - pmt
    }

    const state = computeMortgageState(m, [], today)
    expect(state.currentBalance).toBeCloseTo(expectedBalance, 1)
    expect(state.currentPayment).toBeCloseTo(pmt, 2)
    expect(state.currentRate).toBe(6)
    expect(state.asOf).toBe('2026-01-01')
  })

  it('событие balance перебивает прокрутку', () => {
    const m = baseMortgage()
    const events = [ev({ kind: 'balance', occurredOn: '2025-07-01', amount: 5_000_000 })]
    const today = new Date('2025-08-01') // месяц спустя после якоря

    const pmt = calcPMT(m.principal, m.rate / 1200, m.termMonths)
    const r = m.rate / 1200
    const expectedBalance = 5_000_000 + 5_000_000 * r - pmt

    const state = computeMortgageState(m, events, today)
    expect(state.currentBalance).toBeCloseTo(expectedBalance, 1)

    // Без balance-события остаток за 7 месяцев был бы заметно другим
    const withoutEvent = computeMortgageState(m, [], today)
    expect(state.currentBalance).not.toBeCloseTo(withoutEvent.currentBalance, 0)
  })

  it('prepayment уменьшает остаток и monthsLeft', () => {
    const m = baseMortgage()
    const today = new Date('2026-01-01')

    const base = computeMortgageState(m, [], today)
    const withPrepay = computeMortgageState(
      m,
      [ev({ kind: 'prepayment', occurredOn: '2025-06-01', amount: 1_000_000 })],
      today,
    )

    expect(withPrepay.currentBalance).toBeLessThan(base.currentBalance)
    expect(withPrepay.monthsLeft).not.toBeNull()
    expect(base.monthsLeft).not.toBeNull()
    expect(withPrepay.monthsLeft as number).toBeLessThan(base.monthsLeft as number)
  })

  it('событие rate (слёт) увеличивает monthsLeft', () => {
    const m = baseMortgage()
    const today = new Date('2026-01-01')

    const base = computeMortgageState(m, [], today)
    const withSlip = computeMortgageState(
      m,
      [ev({ kind: 'rate', occurredOn: '2025-06-01', amount: null, rate: 7.5 })],
      today,
    )

    expect(withSlip.currentRate).toBe(7.5)
    expect(withSlip.monthsLeft).not.toBeNull()
    expect(base.monthsLeft).not.toBeNull()
    expect(withSlip.monthsLeft as number).toBeGreaterThan(base.monthsLeft as number)
  })

  it('платёж меньше месячных процентов → monthsLeft === null', () => {
    const m = baseMortgage()
    const today = new Date('2025-02-01')
    // Обязательный платёж 100 ₽/мес — заведомо меньше процентов на остаток ~5.5М при 6%
    const state = computeMortgageState(
      m,
      [ev({ kind: 'payment', occurredOn: '2025-01-01', amount: 100, rate: null })],
      today,
    )

    expect(state.monthsLeft).toBeNull()
    expect(state.payoffDate).toBeNull()
  })

  it('событие с датой в будущем не влияет на «сегодня»', () => {
    const m = baseMortgage()
    const today = new Date('2026-01-01')

    const base = computeMortgageState(m, [], today)
    const withFutureEvent = computeMortgageState(
      m,
      [ev({ kind: 'prepayment', occurredOn: '2026-06-01', amount: 2_000_000 })],
      today,
    )

    expect(withFutureEvent).toEqual(base)
  })
})
