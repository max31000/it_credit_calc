import { describe, it, expect, beforeEach } from 'vitest'
import { useCalculatorStore, type LinkedMortgage } from '../useCalculatorStore'
import type { MortgageParams } from '../../lib/engine'

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
    })

    const state = useCalculatorStore.getState()
    expect(state.params.salary).toBe(400_000)
    expect(state.ownParams.salary).toBe(400_000)
    expect(state.ownParams.depositRate).toBe(18)
    expect(state.params.apartmentPrice).toBe(ownBefore.apartmentPrice)
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
