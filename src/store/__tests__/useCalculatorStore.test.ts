import { describe, it, expect, beforeEach } from 'vitest'
import { useCalculatorStore, linkFromMortgage, type LinkedMortgage } from '../useCalculatorStore'
import { calculate, type MortgageParams } from '../../lib/engine'
import { buildMortgageFact, computeMortgageState, type MortgageFact } from '../../lib/tracker'
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
    mortgageFact: null,
    factError: null,
  })
  useCalculatorStore.getState().setParam('slipMonth', 36)
})

/** Общая ипотека-фикстура для тестов режима: реальный `buildMortgageFact` вместо
 *  вручную собранного объекта — форма `MortgageFact` заморожена спекой (§2.2), и
 *  дублировать её руками в тестах — источник расхождений при следующей правке контракта. */
const mortgageDto: MortgageDto = {
  id: 17,
  title: 'Квартира на Ленина',
  bank: null,
  propertyPrice: 7_000_000,
  downPayment: 1_500_000,
  principal: 5_500_000,
  rate: 6,
  termMonths: 240,
  startedOn: '2024-01-01',
  monthlyPayment: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  usedPropertyBase: 0,
  usedInterestBase: 0,
}

function makeFact(today = new Date('2026-08-13')): MortgageFact {
  return buildMortgageFact(mortgageDto, [], today)
}

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

describe('useCalculatorStore — режим ипотеки (§3.1 спеки, сигнатура расширена §2.6)', () => {
  it('вход в режим не меняет ownParams; выход возвращает их точь-в-точь', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams

    const mortgageParams: MortgageParams = { ...ownBefore, apartmentPrice: 9_000_000, downPayment: 500_000 }
    store.enterMortgageMode(link(), mortgageParams, makeFact())

    expect(useCalculatorStore.getState().ownParams).toEqual(ownBefore)
    expect(useCalculatorStore.getState().params.apartmentPrice).toBe(9_000_000)

    useCalculatorStore.getState().exitMortgageMode()
    expect(useCalculatorStore.getState().params).toEqual(ownBefore)
    expect(useCalculatorStore.getState().linkedMortgage).toBeNull()
  })

  it('вход в режим ипотеки принудительно выключает slipEnabled', () => {
    useCalculatorStore.getState().setSlipEnabled(true)
    useCalculatorStore.getState().enterMortgageMode(link(), useCalculatorStore.getState().ownParams, makeFact())
    expect(useCalculatorStore.getState().slipEnabled).toBe(false)
  })

  it('правка freeMonthly (ключ аккаунта) в режиме ипотеки уходит и в ownParams', () => {
    const store = useCalculatorStore.getState()
    store.enterMortgageMode(link(), store.ownParams, makeFact())

    useCalculatorStore.getState().setParam('freeMonthly', 250_000)

    const state = useCalculatorStore.getState()
    expect(state.params.freeMonthly).toBe(250_000)
    expect(state.ownParams.freeMonthly).toBe(250_000)
  })

  it('правка apartmentPrice (сценарный ключ) в режиме ипотеки не уходит в ownParams', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams
    store.enterMortgageMode(link(), store.ownParams, makeFact())

    useCalculatorStore.getState().setParam('apartmentPrice', 12_000_000)

    const state = useCalculatorStore.getState()
    expect(state.params.apartmentPrice).toBe(12_000_000)
    expect(state.ownParams.apartmentPrice).toBe(ownBefore.apartmentPrice)
  })

  it('setParams — один батч-пересчёт, соблюдает то же правило записи в ownParams', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams
    store.enterMortgageMode(link(), store.ownParams, makeFact())

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
    store.enterMortgageMode(link(), store.ownParams, makeFact())

    useCalculatorStore.getState().setParam('startingSavings', 1_500_000)

    const state = useCalculatorStore.getState()
    expect(state.params.startingSavings).toBe(1_500_000)
    expect(state.ownParams.startingSavings).toBe(1_500_000)
  })

  it('правка usedInterestBase (сценарный ключ) в режиме ипотеки не уходит в ownParams', () => {
    const store = useCalculatorStore.getState()
    const ownBefore = store.ownParams
    store.enterMortgageMode(link(), store.ownParams, makeFact())

    useCalculatorStore.getState().setParam('usedInterestBase', 500_000)

    const state = useCalculatorStore.getState()
    expect(state.params.usedInterestBase).toBe(500_000)
    expect(state.ownParams.usedInterestBase).toBe(ownBefore.usedInterestBase)
  })
})

describe('useCalculatorStore — факт-фаза не подменяет вводные (§1, §2.6 спеки continuous-simulation)', () => {
  it('enterMortgageMode кладёт факт, и result.loanAmount === round(fact.engine.debt)', () => {
    const store = useCalculatorStore.getState()
    const fact = makeFact()
    store.enterMortgageMode(link(), store.ownParams, fact)

    const state = useCalculatorStore.getState()
    expect(state.mortgageFact).toBe(fact)
    expect(state.factError).toBeNull()
    // loanAmount в режиме ипотеки — fact.debt без округления (§2.1 спеки: округляются
    // только minPayment/totalInterest).
    expect(state.result.loanAmount).toBe(fact.engine.debt)
  })

  it('exitMortgageMode обнуляет факт, и результат совпадает с гостевым для ownParams', () => {
    const store = useCalculatorStore.getState()
    store.enterMortgageMode(link(), store.ownParams, makeFact())

    useCalculatorStore.getState().exitMortgageMode()

    const state = useCalculatorStore.getState()
    expect(state.mortgageFact).toBeNull()
    expect(state.factError).toBeNull()
    const guestResult = calculate({
      ...state.ownParams,
      slipMonth: state.slipEnabled ? state.ownParams.slipMonth : 0,
    })
    expect(state.result).toEqual(guestResult)
  })

  it('правка freeMonthly в режиме ипотеки пересчитывает результат с фактом (не теряет его)', () => {
    const store = useCalculatorStore.getState()
    const fact = makeFact()
    store.enterMortgageMode(link(), store.ownParams, fact)

    useCalculatorStore.getState().setParam('freeMonthly', 250_000)

    const state = useCalculatorStore.getState()
    expect(state.mortgageFact).toBe(fact)
    expect(state.params.freeMonthly).toBe(250_000)
    // Факт не потерян пересчётом — сумма кредита прогноза по-прежнему остаток факта,
    // а не что-то, пересчитанное из downPayment/itRate/termYears.
    expect(state.result.loanAmount).toBe(fact.engine.debt)
  })

  it('setFactError записывает и сбрасывает текст ошибки', () => {
    useCalculatorStore.getState().setFactError('сеть недоступна')
    expect(useCalculatorStore.getState().factError).toBe('сеть недоступна')
    useCalculatorStore.getState().setFactError(null)
    expect(useCalculatorStore.getState().factError).toBeNull()
  })
})

describe('useCalculatorStore — onRehydrateStorage не персистит факт (§2.6 спеки)', () => {
  it('mortgageFact и factError обнуляются в режиме ипотеки после рехайдрации', () => {
    const store = useCalculatorStore.getState()
    store.enterMortgageMode(link(), store.ownParams, makeFact())
    expect(useCalculatorStore.getState().mortgageFact).not.toBeNull()

    const onRehydrateFactory = (
      useCalculatorStore as unknown as {
        persist: {
          getOptions: () => {
            onRehydrateStorage?: () => (state: ReturnType<typeof useCalculatorStore.getState>) => void
          }
        }
      }
    ).persist.getOptions().onRehydrateStorage

    const onRehydrate = onRehydrateFactory!()
    const state = useCalculatorStore.getState()
    onRehydrate(state)

    expect(state.mortgageFact).toBeNull()
    expect(state.factError).toBeNull()
  })
})

describe('useCalculatorStore — linkFromMortgage (§2.6 спеки continuous-simulation)', () => {
  it('переносит principal/paidInterest/elapsedMonths из MortgageFact, а не из компактной history', () => {
    const today = new Date('2026-01-01')
    const fact = buildMortgageFact(mortgageDto, [], today)
    const mapped: MortgageModeParams = {
      params: useCalculatorStore.getState().params,
      state: computeMortgageState(mortgageDto, [], today),
      fact,
      termFallback: false,
    }

    const result = linkFromMortgage(mortgageDto, mapped)
    expect(result.balance).toBe(mapped.state.currentBalance)
    expect(result.payment).toBe(mapped.state.currentPayment)
    expect(result.startedOn).toBe(mortgageDto.startedOn)
    expect(result.paidInterest).toBe(fact.history.paidInterest)
    expect(result.principal).toBe(fact.principal)
    expect(result.elapsedMonths).toBe(fact.elapsedMonths)
    expect(result.termFallback).toBe(mapped.termFallback)
    // Больше нет компактной history в контракте (§2.6) — линк не должен её нести.
    expect('history' in result).toBe(false)
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

describe('useCalculatorStore — миграция persist v3/v4 → v5 (§2.6 спеки continuous-simulation)', () => {
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

  it('вычищает устаревшее поле linkedMortgage.history (v3/v4) — не роняет стор', () => {
    // Старый персист (до фазы 6) нёс компактный ряд остатков в `history` — поля больше
    // нет в контракте `LinkedMortgage` (§2.6 спеки); симулируем реальный localStorage
    // приведением типа, раз само поле уже не выразить в LinkedMortgage.
    const persistedLink = { ...link(), history: [5_500_000, 5_400_000, 5_300_000] } as unknown as LinkedMortgage
    const migrated = migrate({ linkedMortgage: persistedLink }, 4)

    expect(migrated.linkedMortgage?.id).toBe(17)
    expect(migrated.linkedMortgage?.balance).toBe(persistedLink.balance)
    expect((migrated.linkedMortgage as unknown as Record<string, unknown> | null)?.history).toBeUndefined()
    expect(migrated.linkedMortgage?.principal).toBeUndefined()
    expect(migrated.linkedMortgage?.paidInterest).toBeUndefined()
    expect(migrated.linkedMortgage?.elapsedMonths).toBeUndefined()
  })

  it('linkedMortgage === null в старом персисте остаётся null после миграции', () => {
    const migrated = migrate({ linkedMortgage: null }, 4)
    expect(migrated.linkedMortgage).toBeNull()
  })
})
