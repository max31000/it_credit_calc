import { describe, it, expect } from 'vitest'
import { mortgageToParams, accountSettingsFromParams } from '../mortgageToParams'
import { computeMortgageState } from '../tracker'
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
  it('ипотека без событий: маппит цену, ставку, срок из планового прогноза', () => {
    const mortgage = baseMortgage()
    const today = new Date('2026-01-01')
    const { params, state, termFallback } = mortgageToParams({ mortgage, events: [], settings, today })

    expect(params.apartmentPrice).toBe(mortgage.propertyPrice)
    expect(params.itRate).toBe(state.currentRate)
    expect(termFallback).toBe(false)
    expect(params.apartmentPrice - params.downPayment).toBe(Math.round(state.currentBalance))
  })

  it('С balance-событием — остаток берётся из события, а не из плановой прокрутки', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'balance', occurredOn: '2025-07-01', amount: 5_000_000 })]
    const today = new Date('2025-08-01')

    const { params, state } = mortgageToParams({ mortgage, events, settings, today })
    expect(state.currentBalance).toBeLessThan(5_000_000) // месяц спустя долг чуть уменьшился
    expect(params.apartmentPrice - params.downPayment).toBe(Math.round(state.currentBalance))
  })

  it('С rate-событием — itRate отражает изменившуюся ставку', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'rate', occurredOn: '2025-06-01', rate: 8, amount: null })]
    const today = new Date('2025-09-01')

    const { params } = mortgageToParams({ mortgage, events, settings, today })
    expect(params.itRate).toBe(8)
  })

  it('monthsLeft === null (платёж не покрывает проценты) → termFallback === true', () => {
    // Ставка огромная, платёж мизерный — проценты растут быстрее платежа
    const mortgage = baseMortgage({ rate: 50, monthlyPayment: 1000, termMonths: 240 })
    const today = new Date('2025-06-01')

    const { state, termFallback, params } = mortgageToParams({ mortgage, events: [], settings, today })
    expect(state.monthsLeft).toBeNull()
    expect(termFallback).toBe(true)
    expect(params.termYears).toBeGreaterThanOrEqual(1)
    expect(params.termYears).toBeLessThanOrEqual(30)
  })

  it('закрытая ипотека (currentBalance === 0) — downPayment === propertyPrice, loanAmount === 0', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'balance', occurredOn: '2025-06-01', amount: 0 })]
    const today = new Date('2025-07-01')

    const { params, state } = mortgageToParams({ mortgage, events, settings, today })
    expect(state.currentBalance).toBe(0)
    expect(params.downPayment).toBe(mortgage.propertyPrice)
    expect(params.apartmentPrice - params.downPayment).toBe(0)
  })

  it('инвариант apartmentPrice − downPayment === round(currentBalance) держится во всех кейсах выше', () => {
    const mortgage = baseMortgage()
    const events = [
      ev({ kind: 'balance', occurredOn: '2025-03-01', amount: 5_200_000 }),
      ev({ kind: 'prepayment', occurredOn: '2025-05-01', amount: 300_000 }),
    ]
    const today = new Date('2025-09-01')
    const { params } = mortgageToParams({ mortgage, events, settings, today })
    const state = computeMortgageState(mortgage, events, today)
    expect(params.apartmentPrice - params.downPayment).toBe(Math.round(state.currentBalance))
  })

  it('horizonYears не превышает термYears', () => {
    const mortgage = baseMortgage({ termMonths: 24 })
    const today = new Date('2025-01-01')
    const { params } = mortgageToParams({ mortgage, events: [], settings, today })
    expect(params.horizonYears).toBeLessThanOrEqual(params.termYears)
  })

  // ─── §2.4 дизайна: startingSavings, usedPropertyBase/usedInterestBase, history ───────
  it('три новых поля доезжают до params: startingSavings из settings, вычеты из mortgage', () => {
    const mortgage = baseMortgage({ usedPropertyBase: 700_000, usedInterestBase: 150_000 })
    const today = new Date('2026-01-01')
    const settingsWithSavings: AccountSettings = { ...settings, startingSavings: 1_200_000 }

    const { params } = mortgageToParams({ mortgage, events: [], settings: settingsWithSavings, today })
    expect(params.startingSavings).toBe(1_200_000)
    expect(params.usedPropertyBase).toBe(700_000)
    expect(params.usedInterestBase).toBe(150_000)
  })

  it('history.points.length − 1 === elapsedMonths', () => {
    const mortgage = baseMortgage()
    const today = new Date('2026-01-01')
    const { history } = mortgageToParams({ mortgage, events: [], settings, today })
    expect(history.points.length - 1).toBe(history.elapsedMonths)
    expect(history.elapsedMonths).toBe(12)
  })

  it('apartmentPrice − downPayment === round(history.points.at(-1).debt)', () => {
    const mortgage = baseMortgage()
    const events = [ev({ kind: 'balance', occurredOn: '2025-06-01', amount: 5_200_000 })]
    const today = new Date('2025-09-01')
    const { params, history } = mortgageToParams({ mortgage, events, settings, today })
    const last = history.points[history.points.length - 1]
    expect(params.apartmentPrice - params.downPayment).toBe(Math.round(last.debt))
  })

  it('accountSettingsFromParams включает startingSavings', () => {
    const mortgage = baseMortgage()
    const today = new Date('2026-01-01')
    const settingsWithSavings: AccountSettings = { ...settings, startingSavings: 500_000 }
    const { params } = mortgageToParams({ mortgage, events: [], settings: settingsWithSavings, today })
    expect(accountSettingsFromParams(params).startingSavings).toBe(500_000)
  })
})
