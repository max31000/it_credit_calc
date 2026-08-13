import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { startTransition } from 'react'
import { calculate, type MortgageParams, type CalculationResult } from '../lib/engine'
import type { AccountSettings } from '../api/types'

/** Шесть полей, которые живут в аккаунте (С3 спеки), а не в сценарии калькулятора */
export const ACCOUNT_SETTING_KEYS = [
  'salary',
  'depositRate',
  'freeMonthly',
  'horizonYears',
  'keyRate',
  'bankDiscount',
] as const

type AccountSettingKey = (typeof ACCOUNT_SETTING_KEYS)[number]

function isAccountSettingKey(key: string): key is AccountSettingKey {
  return (ACCOUNT_SETTING_KEYS as readonly string[]).includes(key)
}

/** Контекст режима ипотеки (§3.1 спеки) — персистится, сами параметры пересчитываются
 *  из свежих данных сервера при каждом входе на страницу калькулятора (§3.3). */
export interface LinkedMortgage {
  id: number
  title: string
  /** YYYY-MM-DD — дата, на которую посчитан остаток */
  asOf: string
  /** Остаток долга трекера — для баннера */
  balance: number
  /** Фактический платёж трекера — для баннера */
  payment: number
  /** true — срок взят из планового графика (допущение 4 §2 спеки) */
  termFallback: boolean
  /** Ставка на момент входа в режим ипотеки (из mortgageToParams, заполняется в
   *  enterMortgageMode) — для баннера, не завязана на текущее положение слайдера ставки.
   *  Опционально: undefined в персисте, сохранённом до добавления поля — тогда строку
   *  ставки в баннере не показываем. */
  rate?: number
}

interface CalculatorState {
  /** Активные параметры: то, что видят слайдеры и движок */
  params: MortgageParams
  /** «Свои» параметры (С1). В режиме ипотеки сохраняются нетронутыми */
  ownParams: MortgageParams
  /** Тумблер сценария слёта. По умолчанию выключен — расчёт идёт по льготной ставке. */
  slipEnabled: boolean
  linkedMortgage: LinkedMortgage | null
  result: CalculationResult
  setParam: <K extends keyof MortgageParams>(key: K, value: MortgageParams[K]) => void
  /** Один пересчёт движка на несколько полей сразу (нужен для relinkLoan) */
  setParams: (patch: Partial<MortgageParams>) => void
  setSlipEnabled: (value: boolean) => void
  /** Месяц слёта, который реально участвует в расчёте: 0, если тумблер выключен. */
  effectiveSlipMonth: () => number
  /** Вход/обновление режима ипотеки. Идемпотентна: повторный вызов с теми же данными — no-op по смыслу */
  enterMortgageMode: (link: LinkedMortgage, params: MortgageParams) => void
  /** Возврат к своим параметрам */
  exitMortgageMode: () => void
  /** Применить настройки аккаунта (С3), не вызывая обратного PUT */
  applyAccountSettings: (s: AccountSettings) => void
}

const defaultParams: MortgageParams = {
  apartmentPrice: 7_000_000,
  downPayment: 1_470_000,
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

/** Слёт уходит в движок только если тумблер включён — иначе params.slipMonth лишь «запомненная» позиция слайдера. */
const recalc = (params: MortgageParams, slipEnabled: boolean): CalculationResult =>
  calculate({ ...params, slipMonth: slipEnabled ? params.slipMonth : 0 })

interface PersistedCalculatorState {
  params: MortgageParams
  ownParams: MortgageParams
  slipEnabled: boolean
  linkedMortgage: LinkedMortgage | null
}

export const useCalculatorStore = create<CalculatorState>()(
  persist(
    (set, get) => ({
      params: defaultParams,
      ownParams: defaultParams,
      slipEnabled: false,
      linkedMortgage: null,
      result: recalc(defaultParams, false),
      setParam: (key, value) => {
        const state = get()
        const newParams = { ...state.params, [key]: value }
        // Ключ аккаунта → пишем и в params, и в ownParams (это свойство пользователя,
        // а не сценария; правка в режиме ипотеки должна остаться и уехать на сервер).
        // Сценарный ключ → в ownParams, только если мы не в режиме ипотеки (§3.1).
        const patchOwn = isAccountSettingKey(key as string) || state.linkedMortgage === null
        const newOwnParams = patchOwn ? { ...state.ownParams, [key]: value } : state.ownParams
        set({ params: newParams, ownParams: newOwnParams })
        startTransition(() => {
          set({ result: recalc(newParams, get().slipEnabled) })
        })
      },
      setParams: (patch) => {
        const state = get()
        const newParams = { ...state.params, ...patch }
        let newOwnParams = state.ownParams
        for (const key of Object.keys(patch) as Array<keyof MortgageParams>) {
          if (isAccountSettingKey(key as string) || state.linkedMortgage === null) {
            newOwnParams = { ...newOwnParams, [key]: patch[key] }
          }
        }
        set({ params: newParams, ownParams: newOwnParams })
        startTransition(() => {
          set({ result: recalc(newParams, get().slipEnabled) })
        })
      },
      setSlipEnabled: (value) => {
        set({ slipEnabled: value })
        startTransition(() => {
          set({ result: recalc(get().params, value) })
        })
      },
      effectiveSlipMonth: () => (get().slipEnabled ? get().params.slipMonth : 0),
      enterMortgageMode: (link, params) => {
        const state = get()
        // slipMonth — не трогаем, остаётся из ownParams (слёт — гипотеза, а не факт).
        const finalParams = { ...params, slipMonth: state.ownParams.slipMonth }
        // rate — фиксируем ставку на момент входа (из mortgageToParams), а не читаем её
        // из params.itRate живьём в баннере: слайдер калькулятора мог её сдвинуть.
        const finalLink: LinkedMortgage = { ...link, rate: params.itRate }
        set({ linkedMortgage: finalLink, params: finalParams, slipEnabled: false })
        startTransition(() => {
          set({ result: recalc(finalParams, false) })
        })
      },
      exitMortgageMode: () => {
        const own = get().ownParams
        set({ linkedMortgage: null, params: own })
        startTransition(() => {
          set({ result: recalc(own, get().slipEnabled) })
        })
      },
      applyAccountSettings: (s) => {
        const state = get()
        const patch: Partial<MortgageParams> = {
          salary: s.salary,
          depositRate: s.depositRate,
          freeMonthly: s.freeMonthly,
          horizonYears: s.horizonYears,
          keyRate: s.keyRate,
          bankDiscount: s.bankDiscount,
        }
        // Инвариант horizonYears ≤ termYears держим только для активных params: в режиме
        // ипотеки termYears может быть короче серверного горизонта (например, 2 года до
        // погашения). ownParams получает серверное значение как есть — сохраняем и не
        // подменяем то, что реально лежит в настройках аккаунта.
        const newParams = {
          ...state.params,
          ...patch,
          horizonYears: Math.min(s.horizonYears, state.params.termYears),
        }
        const newOwnParams = { ...state.ownParams, ...patch }
        set({ params: newParams, ownParams: newOwnParams })
        startTransition(() => {
          set({ result: recalc(newParams, get().slipEnabled) })
        })
      },
    }),
    {
      name: 'mortgage-calculator-params',
      version: 3,
      partialize: (state) => ({
        params: state.params,
        ownParams: state.ownParams,
        slipEnabled: state.slipEnabled,
        linkedMortgage: state.linkedMortgage,
      }),
      migrate: (persisted, version): PersistedCalculatorState => {
        const prev = persisted as Partial<PersistedCalculatorState>
        if (version < 3) {
          return {
            params: prev.params ?? defaultParams,
            ownParams: prev.params ?? defaultParams,
            // Старое сохранённое значение slipMonth (обычно дефолтные 36) — не осознанный
            // выбор пользователя, а дефолт слайдера. До v2 тумблера не было — выключаем.
            slipEnabled: version < 2 ? false : (prev.slipEnabled ?? false),
            linkedMortgage: null,
          }
        }
        return {
          params: prev.params ?? defaultParams,
          ownParams: prev.ownParams ?? defaultParams,
          slipEnabled: prev.slipEnabled ?? false,
          linkedMortgage: prev.linkedMortgage ?? null,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Защита от неполных/устаревших данных: восстанавливаем дефолты для undefined полей
          state.params = { ...defaultParams, ...state.params }
          state.ownParams = { ...defaultParams, ...state.ownParams }
          state.slipEnabled = state.slipEnabled ?? false
          state.linkedMortgage = state.linkedMortgage ?? null
          state.result = recalc(state.params, state.slipEnabled)
        }
      },
    }
  )
)
