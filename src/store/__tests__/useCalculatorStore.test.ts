import { describe, it, expect, beforeEach } from 'vitest'
import { useCalculatorStore, linkFromMortgage, type LinkedMortgage } from '../useCalculatorStore'
import type { MortgageParams } from '../../lib/engine'
import type { MortgageModeParams } from '../../lib/mortgageToParams'
import type { MortgageDto } from '../../api/types'

// Снимок дефолтных параметров, снятый при загрузке модуля (до мутаций тестами) —
// используется для полного сброса стора между тестами (иначе тесты режима ипотеки
// мутируют общий инстанс стора и «текут» друг в друга).
const initialParams: MortgageParams = { ...useCalculatorStore.getState().params }

beforeEach(() => {
  localStorage.clear()
  useCalculatorStore.setState({
    params: { ...initialParams },
    ownParams: { ...initialParams },
    slipEnabled: false,
    linkedMortgage: null,
  })
  useCalculatorStore.getState().setParam('slipMonth', 36)
})

describe('useCalculatorStore — тумблер слёта', () => {
  it('slipEnabled выключен по умолчанию', () => {
    expect(useCalculatorStore.getState().slipEnabled).toBe(false)
  })

  it('при slipEnabled=false result.slip === null независимо от params.slipMonth', () => {
    useCalculatorStore.getState().setParam('slipMonth', 36)
    expect(useCalculatorStore.getState().params.slipMonth).toBe(36)
    expect(useCalculatorStore.getState().result.slip).toBeNull()
  })

  it('effectiveSlipMonth() === 0 при выключенном тумблере', () => {
    expect(useCalculatorStore.getState().effectiveSlipMonth()).toBe(0)
  })

  it('после setSlipEnabled(true) result.slip !== null и effectiveSlipMonth === params.slipMonth', () => {
    useCalculatorStore.getState().setSlipEnabled(true)
    const state = useCalculatorStore.getState()
    expect(state.result.slip).not.toBeNull()
    expect(state.effectiveSlipMonth()).toBe(state.params.slipMonth)
  })

  it('выключение тумблера обратно возвращает result.slip в null, но params.slipMonth сохраняется', () => {
    useCalculatorStore.getState().setSlipEnabled(true)
    useCalculatorStore.getState().setSlipEnabled(false)
    const state = useCalculatorStore.getState()
    expect(state.result.slip).toBeNull()
    expect(state.params.slipMonth).toBe(36)
  })
})

const link = (over: Partial<LinkedMortgage> = {}): LinkedMortgage => ({
  id: 17,
  title: 'Квартира на Ленина',
  asOf: '2026-08-12',
  balance: 4_120_000,
  payment: 41_800,
  termFallback: false,
  ...over,
})

describe('useCalculatorStore — режим ипотеки (§3.1 спеки)', () => {
  it('вход в режим не меняет ownParams; выход возвращает их точь-в-точь', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams

    const mortgageParams: MortgageParams = { ...ownBefore, apartmentPrice: 9_000_000, downPayment: 500_000 }
    store.enterMortgageMode(link(), mortgageParams)

    expect(useCalculatorStore.getState().ownParams).toEqual(ownBefore)
    expect(useCalculatorStore.getState().params.apartmentPrice).toBe(9_000_000)

    useCalculatorStore.getState().exitMortgageMode()
    expect(useCalculatorStore.getState().params).toEqual(ownBefore)
    expect(useCalculatorStore.getState().linkedMortgage).toBeNull()
  })

  it('вход в режим ипотеки принудительно выключает slipEnabled', () => {
    useCalculatorStore.getState().setSlipEnabled(true)
    useCalculatorStore.getState().enterMortgageMode(link(), useCalculatorStore.getState().ownParams)
    expect(useCalculatorStore.getState().slipEnabled).toBe(false)
  })

  it('правка freeMonthly (ключ аккаунта) в режиме ипотеки уходит и в ownParams', () => {
    const store = useCalculatorStore.getState()
    store.enterMortgageMode(link(), store.ownParams)

    useCalculatorStore.getState().setParam('freeMonthly', 250_000)

    const state = useCalculatorStore.getState()
    expect(state.params.freeMonthly).toBe(250_000)
    expect(state.ownParams.freeMonthly).toBe(250_000)
  })

  it('правка apartmentPrice (сценарный ключ) в режиме ипотеки не уходит в ownParams', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams
    store.enterMortgageMode(link(), store.ownParams)

    useCalculatorStore.getState().setParam('apartmentPrice', 12_000_000)

    const state = useCalculatorStore.getState()
    expect(state.params.apartmentPrice).toBe(12_000_000)
    expect(state.ownParams.apartmentPrice).toBe(ownBefore.apartmentPrice)
  })

  it('setParams — один батч-пересчёт, соблюдает то же правило записи в ownParams', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams
    store.enterMortgageMode(link(), store.ownParams)

    useCalculatorStore.getState().setParams({ apartmentPrice: 8_000_000, downPayment: 1_000_000 })

    const state = useCalculatorStore.getState()
    expect(state.params.apartmentPrice).toBe(8_000_000)
    expect(state.params.downPayment).toBe(1_000_000)
    expect(state.ownParams.apartmentPrice).toBe(ownBefore.apartmentPrice)
    expect(state.ownParams.downPayment).toBe(ownBefore.downPayment)
  })

  it('applyAccountSettings пишет в оба набора и не трогает сценарные поля', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams

    store.applyAccountSettings({
      salary: 400_000,
      depositRate: 18,
      freeMonthly: 150_000,
      horizonYears: 12,
      keyRate: 17,
      bankDiscount: 1,
      startingSavings: 900_000,
    })

    const state = useCalculatorStore.getState()
    expect(state.params.salary).toBe(400_000)
    expect(state.ownParams.salary).toBe(400_000)
    expect(state.ownParams.depositRate).toBe(18)
    expect(state.ownParams.startingSavings).toBe(900_000)
    expect(state.params.apartmentPrice).toBe(ownBefore.apartmentPrice)
  })

  it('правка startingSavings (ключ аккаунта) в режиме ипотеки уходит и в ownParams', () => {
    const store = useCalculatorStore.getState()
    store.enterMortgageMode(link(), store.ownParams)

    useCalculatorStore.getState().setParam('startingSavings', 1_500_000)

    const state = useCalculatorStore.getState()
    expect(state.params.startingSavings).toBe(1_500_000)
    expect(state.ownParams.startingSavings).toBe(1_500_000)
  })

  it('правка usedInterestBase (сценарный ключ) в режиме ипотеки не уходит в ownParams', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams
    store.enterMortgageMode(link(), store.ownParams)

    useCalculatorStore.getState().setParam('usedInterestBase', 500_000)

    const state = useCalculatorStore.getState()
    expect(state.params.usedInterestBase).toBe(500_000)
    expect(state.ownParams.usedInterestBase).toBe(ownBefore.usedInterestBase)
  })
})

describe('useCalculatorStore — linkFromMortgage (§2.6 дизайна таймлайна)', () => {
  it('history.at(-1) === round(state.currentBalance)', () => {
    const mortgage: MortgageDto = {
      id: 17,
      title: 'Квартира на Ленина',
      bank: null,
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
    }
    const mapped: MortgageModeParams = {
      params: useCalculatorStore.getState().params,
      state: {
        currentBalance: 5_123_456.78,
        currentRate: 6,
        currentPayment: 41_000,
        monthsLeft: 200,
        payoffDate: '2042-01',
        paidPrincipal: 376_543.22,
        progressPct: 0.07,
        asOf: '2026-01-01',
      },
      termFallback: false,
      history: {
        points: [
          { month: 0, yearMonth: '2025-01', debt: 5_500_000, interest: 0, rate: 6, payment: 41_000 },
          { month: 1, yearMonth: '2025-02', debt: 5_123_456.78, interest: 27_500, payment: 41_000, rate: 6 },
        ],
        elapsedMonths: 1,
        paidInterest: 27_500,
        interestByYear: { 2025: 27_500 },
      },
    }

    const result = linkFromMortgage(mortgage, mapped)
    expect(result.history?.at(-1)).toBe(Math.round(mapped.state.currentBalance))
    expect(result.startedOn).toBe(mortgage.startedOn)
    expect(result.paidInterest).toBe(mapped.history.paidInterest)
    expect(result.termFallback).toBe(mapped.termFallback)
    expect(result.balance).toBe(mapped.state.currentBalance)
  })
})

type Migrated = {
  params: MortgageParams
  ownParams: MortgageParams
  slipEnabled: boolean
  linkedMortgage: LinkedMortgage | null
}

const migrate = (persisted: unknown, version: number): Migrated =>
  (
    useCalculatorStore as unknown as {
      persist: { getOptions: () => { migrate: (p: unknown, v: number) => unknown } }
    }
  ).persist.getOptions().migrate(persisted, version) as Migrated

describe('useCalculatorStore — миграция persist → v3', () => {
  it('v2 → v3: создаёт ownParams из params, сбрасывает linkedMortgage', () => {
    const oldParams: MortgageParams = { ...useCalculatorStore.getState().ownParams, apartmentPrice: 5_555_555 }
    const migrated = migrate({ params: oldParams, slipEnabled: true }, 2)

    expect(migrated.ownParams).toEqual(oldParams)
    expect(migrated.params).toEqual(oldParams)
    expect(migrated.slipEnabled).toBe(true)
    expect(migrated.linkedMortgage).toBeNull()
  })

  it('v1 → v3: тумблера слёта тогда не было — остаётся выключенным, ownParams появляется', () => {
    const oldParams: MortgageParams = { ...useCalculatorStore.getState().ownParams, apartmentPrice: 4_444_444 }
    const migrated = migrate({ params: oldParams }, 1)

    expect(migrated.ownParams).toEqual(oldParams)
    expect(migrated.slipEnabled).toBe(false)
    expect(migrated.linkedMortgage).toBeNull()
  })

  it('битый/пустой снимок из localStorage не роняет миграцию — дефолты в обоих наборах', () => {
    const fresh = useCalculatorStore.getState().params
    for (const [persisted, version] of [
      [{}, 1],
      [{}, 3],
      [{ params: undefined, ownParams: undefined }, 3],
    ] as Array<[unknown, number]>) {
      const migrated = migrate(persisted, version)
      expect(migrated.params).toEqual(fresh)
      expect(migrated.ownParams).toEqual(fresh)
      expect(migrated.linkedMortgage).toBeNull()
    }
  })
})

describe('useCalculatorStore — миграция persist v3 → v4 (§2.6 дизайна таймлайна)', () => {
  it('дозаливает три новых поля нулями в params и ownParams', () => {
    // Персист версии 3 не содержит новых полей — типобезопасно этого не выразить,
    // поэтому строим объект без Omit-проверки, как реальный localStorage.
    const oldFields = {
      apartmentPrice: 7_000_000,
      downPayment: 1_500_000,
      itRate: 6,
      termYears: 20,
      freeMonthly: 100_000,
      depositRate: 16,
      horizonYears: 10,
      slipMonth: 36,
      keyRate: 16,
      bankDiscount: 0.5,
      salary: null,
    }
    const migrated = migrate({ params: oldFields, ownParams: oldFields, slipEnabled: true }, 3)

    expect(migrated.params.startingSavings).toBe(0)
    expect(migrated.params.usedPropertyBase).toBe(0)
    expect(migrated.params.usedInterestBase).toBe(0)
    expect(migrated.ownParams.startingSavings).toBe(0)
    expect(migrated.ownParams.usedPropertyBase).toBe(0)
    expect(migrated.ownParams.usedInterestBase).toBe(0)
    expect(migrated.slipEnabled).toBe(true)
  })

  it('сбрасывает linkedMortgage.history в undefined — старый персист его не содержит', () => {
    const migrated = migrate({ linkedMortgage: { ...link(), history: [1, 2, 3] } }, 3)
    expect(migrated.linkedMortgage?.history).toBeUndefined()
    expect(migrated.linkedMortgage?.id).toBe(17)
  })
})
