import { describe, it, expect } from 'vitest'
import { relinkLoan, type LoanTriple } from '../loanLink'

const base: LoanTriple = { propertyPrice: 7_000_000, downPayment: 1_400_000, principal: 5_600_000 }

describe('relinkLoan', () => {
  it('инвариант principal === propertyPrice − downPayment для всех трёх полей', () => {
    const cases: Array<[keyof LoanTriple, number]> = [
      ['propertyPrice', 8_000_000],
      ['downPayment', 2_000_000],
      ['principal', 4_000_000],
    ]
    for (const [field, value] of cases) {
      const next = relinkLoan(base, field, value)
      expect(next.principal).toBe(next.propertyPrice - next.downPayment)
      expect(next.propertyPrice).toBeGreaterThanOrEqual(0)
      expect(next.downPayment).toBeGreaterThanOrEqual(0)
      expect(next.principal).toBeGreaterThanOrEqual(0)
    }
  })

  it('propertyPrice: сохраняет долю взноса (20%)', () => {
    const next = relinkLoan(base, 'propertyPrice', 10_000_000)
    expect(next.propertyPrice).toBe(10_000_000)
    expect(next.downPayment).toBe(2_000_000) // 20% от 10 млн
    expect(next.principal).toBe(8_000_000)
  })

  it('propertyPrice: при prev.propertyPrice === 0 доля по умолчанию 0.2', () => {
    const zero: LoanTriple = { propertyPrice: 0, downPayment: 0, principal: 0 }
    const next = relinkLoan(zero, 'propertyPrice', 5_000_000)
    expect(next.downPayment).toBe(1_000_000)
    expect(next.principal).toBe(4_000_000)
  })

  it('downPayment: клампится в [0, price], пересчитывает кредит', () => {
    expect(relinkLoan(base, 'downPayment', -100).downPayment).toBe(0)
    const overshoot = relinkLoan(base, 'downPayment', 20_000_000)
    expect(overshoot.downPayment).toBe(base.propertyPrice)
    expect(overshoot.principal).toBe(0)
    const mid = relinkLoan(base, 'downPayment', 2_000_000)
    expect(mid.downPayment).toBe(2_000_000)
    expect(mid.principal).toBe(5_000_000)
  })

  it('principal: клампится в [0, price], пересчитывает взнос', () => {
    expect(relinkLoan(base, 'principal', -100).principal).toBe(0)
    const overshoot = relinkLoan(base, 'principal', 20_000_000)
    expect(overshoot.principal).toBe(base.propertyPrice)
    expect(overshoot.downPayment).toBe(0)
    const mid = relinkLoan(base, 'principal', 4_000_000)
    expect(mid.principal).toBe(4_000_000)
    expect(mid.downPayment).toBe(3_000_000)
  })
})
