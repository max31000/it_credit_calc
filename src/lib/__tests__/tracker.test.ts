import { describe, it, expect } from 'vitest'
import { computeMortgageState, buildDebtHistory } from '../tracker'
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
  usedPropertyBase: 0,
  usedInterestBase: 0,
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

// ─── buildDebtHistory (§4 спеки docs/specs/2026-08-13-mortgage-timeline-design.md) ─────────
describe('buildDebtHistory', () => {
  it('ипотека без событий: points.length === elapsed+1, долг монотонно убывает, проценты суммируются', () => {
    const m = baseMortgage()
    const today = new Date('2026-01-01') // 12 месяцев с startedOn

    const h = buildDebtHistory(m, [], today)
    expect(h.points.length).toBe(h.elapsedMonths + 1)
    expect(h.elapsedMonths).toBe(12)

    for (let i = 1; i < h.points.length; i++) {
      expect(h.points[i].debt).toBeLessThanOrEqual(h.points[i - 1].debt)
    }

    expect(h.paidInterest).toBeGreaterThan(0)
    const sumByYear = Object.values(h.interestByYear).reduce((a, b) => a + b, 0)
    expect(sumByYear).toBeCloseTo(h.paidInterest, 1)
  })

  it('today < startedOn → одна точка [principal], elapsedMonths === 0, paidInterest === 0', () => {
    const m = { ...baseMortgage(), startedOn: '2026-06-01' }
    const today = new Date('2026-01-01')

    const h = buildDebtHistory(m, [], today)
    expect(h.elapsedMonths).toBe(0)
    expect(h.points.length).toBe(1)
    expect(h.points[0].debt).toBe(m.principal)
    expect(h.paidInterest).toBe(0)
  })

  it('balance-событие в середине → точка этого месяца равна сумме события', () => {
    const m = baseMortgage()
    const events = [ev({ kind: 'balance', occurredOn: '2025-07-01', amount: 5_000_000 })]
    const today = new Date('2026-01-01')

    const h = buildDebtHistory(m, events, today)
    // 2025-07 — месяц 6 от выдачи (2025-01)
    expect(h.points[6].yearMonth).toBe('2025-07')
    expect(h.points[6].debt).toBe(5_000_000)
  })

  it('balance и prepayment в одном месяце: досрочка после снимка вычитается, до — нет', () => {
    const m = baseMortgage()
    const today = new Date('2026-01-01')

    // Досрочка ПОСЛЕ снимка (позже в том же месяце) — должна вычесться из снимка
    const afterSnapshot = buildDebtHistory(
      m,
      [
        ev({ kind: 'balance', occurredOn: '2025-07-01', amount: 5_000_000 }),
        ev({ kind: 'prepayment', occurredOn: '2025-07-15', amount: 300_000 }),
      ],
      today,
    )
    expect(afterSnapshot.points[6].debt).toBe(4_700_000)

    // Досрочка ДО снимка (раньше в том же месяце) — снимок её перебивает, не вычитается
    const beforeSnapshot = buildDebtHistory(
      m,
      [
        ev({ kind: 'prepayment', occurredOn: '2025-07-01', amount: 300_000 }),
        ev({ kind: 'balance', occurredOn: '2025-07-15', amount: 5_000_000 }),
      ],
      today,
    )
    expect(beforeSnapshot.points[6].debt).toBe(5_000_000)
  })

  it('rate-событие → points[k].rate меняется с нужного месяца, проценты дальше считаются по новой', () => {
    const m = baseMortgage()
    const events = [ev({ kind: 'rate', occurredOn: '2025-07-01', rate: 8, amount: null })]
    const today = new Date('2026-01-01')

    const h = buildDebtHistory(m, events, today)
    expect(h.points[5].rate).toBe(6) // 2025-06, до события
    expect(h.points[6].rate).toBe(8) // 2025-07, событие применилось
    expect(h.points[7].rate).toBe(8) // 2025-08, ставка держится

    // Проценты в месяце 7 считаются от долга на конец месяца 6 по новой ставке 8%
    const expectedInterest = round2(h.points[6].debt * (8 / 1200))
    expect(h.points[7].interest).toBeCloseTo(expectedInterest, 1)
  })

  it('инвариант: last(points).debt === computeMortgageState(...).currentBalance', () => {
    const m = baseMortgage()
    const events = [
      ev({ kind: 'balance', occurredOn: '2025-03-01', amount: 5_200_000 }),
      ev({ kind: 'prepayment', occurredOn: '2025-05-01', amount: 300_000 }),
      ev({ kind: 'rate', occurredOn: '2025-08-01', rate: 7, amount: null }),
    ]
    const today = new Date('2025-11-01')

    const h = buildDebtHistory(m, events, today)
    const state = computeMortgageState(m, events, today)
    expect(h.points[h.points.length - 1].debt).toBe(state.currentBalance)
  })

  // §4.2 дизайна docs/specs/2026-08-13-mortgage-timeline-design.md, расхождение (а): досрочка
  // должна уменьшать остаток уже в точке месяца события (до начисления процентов за следующий
  // месяц), а не только начиная со следующей точки.
  it('досрочное погашение без снимка остатка: эффект виден с месяца события, а не с K+1', () => {
    const m = baseMortgage()
    const today = new Date('2026-01-01') // 12 месяцев с startedOn (2025-01-01)
    const prepayAmount = 500_000
    const prepayMonth = 6 // 2025-07 — месяц 6 от выдачи, без balance-событий

    const h = buildDebtHistory(
      m,
      [ev({ kind: 'prepayment', occurredOn: '2025-07-01', amount: prepayAmount })],
      today,
    )

    // Ожидание — закрытая форма остатка аннуитетного кредита через n месяцев без вмешательств:
    //   B_n = P·(1+r)^n − PMT·((1+r)^n − 1) / r,   r = rate/1200, PMT = calcPMT(P, r, term)
    // Без досрочки остаток на конец месяца K (chistый график):
    //   B_K = P·(1+r)^K − PMT·((1+r)^K − 1) / r
    // По правилу (а) досрочка X списывается в конце месяца K, до процентов за K+1, поэтому
    // остаток В ТОЧКЕ K уже содержит вычитание:
    //   points[K].debt = B_K − X
    // а дальше баланс продолжает амортизироваться от (B_K − X) с тем же PMT и r — то есть
    // остаток через m месяцев после K:
    //   B_{K+m} = (B_K − X)·(1+r)^m − PMT·((1+r)^m − 1) / r
    const P = m.principal
    const r = m.rate / 1200
    const pmt = calcPMT(P, r, m.termMonths)
    const balanceNoPrepay = (n: number) => P * (1 + r) ** n - (pmt * ((1 + r) ** n - 1)) / r

    const bK = balanceNoPrepay(prepayMonth)
    const expectedAtK = round2(bK - prepayAmount)

    // 1) Остаток по чистому графику (без досрочки) на месяце K заметно больше.
    expect(h.points[prepayMonth].debt).toBeLessThan(round2(bK))
    expect(bK - h.points[prepayMonth].debt).toBeCloseTo(prepayAmount, 1)

    // 2) Точное значение остатка в точке K уже учитывает досрочку (эффект «в конце своего
    // месяца», не отложен на K+1).
    expect(h.points[prepayMonth].debt).toBeCloseTo(expectedAtK, 1)

    // 3) Месяц K+1 амортизируется уже от уменьшенного остатка — проценты за K+1 начислены
    // на (B_K − X), а не на B_K.
    const bK1WithPrepay = (bK - prepayAmount) * (1 + r) - pmt
    expect(h.points[prepayMonth + 1].debt).toBeCloseTo(round2(bK1WithPrepay), 1)
  })
})

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
