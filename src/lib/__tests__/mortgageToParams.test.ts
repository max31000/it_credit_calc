/**
 * mortgageToParams — переписан целиком (§12.3 спеки
 * docs/specs/2026-08-14-continuous-simulation-design.md): старые кейсы кодировали отвергнутую
 * модель (`apartmentPrice − downPayment === round(currentBalance)`, срок из проекции погашения
 * вместо остатка по договору). Новая модель: `downPayment` — реальный взнос по договору,
 * движок получает сумму кредита/ставку/платёж/срок из `fact.engine` напрямую, `termYears` —
 * только граница слайдера слёта.
 */
import { describe, it, expect } from 'vitest'
import { mortgageToParams, accountSettingsFromParams } from '../mortgageToParams'
import { computeMortgageState, buildMortgageFact } from '../tracker'
import type { AccountSettings, MortgageDto, MortgageEventDto } from '../../api/types'

const baseMortgage = (over: Partial<MortgageDto> = {}): MortgageDto => ({
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
  usedPropertyBase: 0,
  usedInterestBase: 0,
  ...over,
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

const settings: AccountSettings = {
  salary: 350_000,
  depositRate: 16,
  freeMonthly: 100_000,
  horizonYears: 10,
  keyRate: 16,
  bankDiscount: 0.5,
  startingSavings: 0,
}

describe('mortgageToParams', () => {
  it('downPayment === mortgage.downPayment (реальный взнос, не синтетический)', () => {
    const mortgage = baseMortgage()
    const today = new Date('2026-01-01')
    const { params } = mortgageToParams({ mortgage, events: [], settings, today })

    expect(params.downPayment).toBe(mortgage.downPayment)
    expect(params.apartmentPrice).toBe(mortgage.propertyPrice)
  })

  it('И8: itRate === fact.engine.rate, apartmentPrice === propertyPrice, downPayment === mortgage.downPayment', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'rate', occurredOn: '2025-06-01', rate: 8, amount: null })]
    const today = new Date('2025-09-01')

    const { params, fact } = mortgageToParams({ mortgage, events, settings, today })
    expect(params.itRate).toBe(fact.engine.rate)
    expect(params.apartmentPrice).toBe(mortgage.propertyPrice)
    expect(params.downPayment).toBe(mortgage.downPayment)
  })

  it('С balance-событием — itRate и downPayment не зависят от снимка остатка', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'balance', occurredOn: '2025-07-01', amount: 5_000_000 })]
    const today = new Date('2025-08-01')

    const { params, fact } = mortgageToParams({ mortgage, events, settings, today })
    expect(fact.engine.debt).toBeLessThan(5_000_000) // месяц спустя долг чуть уменьшился
    expect(params.downPayment).toBe(mortgage.downPayment) // взнос — не функция от остатка
    expect(params.apartmentPrice).toBe(mortgage.propertyPrice)
  })

  it('termFallback === !fact.paymentCoversInterest (переименованный смысл)', () => {
    // Ставка огромная, платёж мизерный — проценты растут быстрее платежа
    const mortgage = baseMortgage({ rate: 50, monthlyPayment: 1000, termMonths: 240 })
    const today = new Date('2025-06-01')

    const { fact, termFallback, params } = mortgageToParams({ mortgage, events: [], settings, today })
    expect(fact.paymentCoversInterest).toBe(false)
    expect(termFallback).toBe(true)
    expect(params.termYears).toBeGreaterThanOrEqual(1)
    expect(params.termYears).toBeLessThanOrEqual(30)
  })

  it('обычная ипотека (платёж покрывает проценты) — termFallback === false', () => {
    const mortgage = baseMortgage()
    const today = new Date('2026-01-01')
    const { termFallback, fact } = mortgageToParams({ mortgage, events: [], settings, today })
    expect(fact.paymentCoversInterest).toBe(true)
    expect(termFallback).toBe(false)
  })

  it('закрытая ипотека (currentBalance === 0) — downPayment остаётся реальным взносом по договору', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'balance', occurredOn: '2025-06-01', amount: 0 })]
    const today = new Date('2025-07-01')

    const { params, fact } = mortgageToParams({ mortgage, events, settings, today })
    expect(fact.engine.debt).toBe(0)
    expect(params.downPayment).toBe(mortgage.downPayment)
  })

  it('термYears покрывает остаток срока: clamp(ceil(fact.engine.remainingMonths / 12), 1, 30)', () => {
    const mortgage = baseMortgage({ termMonths: 84 }) // 7 лет
    const today = new Date('2026-01-01') // 12 месяцев прошло
    const { params, fact } = mortgageToParams({ mortgage, events: [], settings, today })

    expect(fact.engine.remainingMonths).toBe(84 - 12)
    expect(params.termYears).toBe(Math.ceil((84 - 12) / 12))
  })

  it('горизонт не ужимается сроком ипотеки (§7.4 спеки) — короткий остаток срока не режет horizonYears', () => {
    const mortgage = baseMortgage({ termMonths: 24 }) // короткий срок
    const today = new Date('2025-01-01')
    const settingsLongHorizon: AccountSettings = { ...settings, horizonYears: 15 }
    const { params } = mortgageToParams({ mortgage, events: [], settings: settingsLongHorizon, today })

    expect(params.horizonYears).toBe(15)
    expect(params.termYears).toBeLessThan(params.horizonYears)
  })

  it('три поля доезжают до params: startingSavings из settings, вычеты из mortgage', () => {
    const mortgage = baseMortgage({ usedPropertyBase: 700_000, usedInterestBase: 150_000 })
    const today = new Date('2026-01-01')
    const settingsWithSavings: AccountSettings = { ...settings, startingSavings: 1_200_000 }

    const { params } = mortgageToParams({ mortgage, events: [], settings: settingsWithSavings, today })
    expect(params.startingSavings).toBe(1_200_000)
    expect(params.usedPropertyBase).toBe(700_000)
    expect(params.usedInterestBase).toBe(150_000)
  })

  it('fact.engine.debt === state.currentBalance', () => {
    const mortgage = baseMortgage()
    const events = [
      ev({ kind: 'balance', occurredOn: '2025-03-01', amount: 5_200_000 }),
      ev({ kind: 'prepayment', occurredOn: '2025-05-01', amount: 300_000 }),
    ]
    const today = new Date('2025-09-01')
    const { fact } = mortgageToParams({ mortgage, events, settings, today })
    const state = computeMortgageState(mortgage, events, today)
    expect(fact.engine.debt).toBe(state.currentBalance)
  })

  it('fact, возвращённый mortgageToParams, совпадает с buildMortgageFact напрямую', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'rate', occurredOn: '2025-06-01', rate: 7, amount: null })]
    const today = new Date('2025-12-01')
    const { fact } = mortgageToParams({ mortgage, events, settings, today })
    const direct = buildMortgageFact(mortgage, events, today)
    expect(fact).toEqual(direct)
  })

  it('accountSettingsFromParams включает startingSavings', () => {
    const mortgage = baseMortgage()
    const today = new Date('2026-01-01')
    const settingsWithSavings: AccountSettings = { ...settings, startingSavings: 500_000 }
    const { params } = mortgageToParams({ mortgage, events: [], settings: settingsWithSavings, today })
    expect(accountSettingsFromParams(params).startingSavings).toBe(500_000)
  })
})
