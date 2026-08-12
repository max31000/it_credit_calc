import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { startTransition } from 'react'
import { calculate, type MortgageParams, type CalculationResult } from '../lib/engine'

interface CalculatorState {
  params: MortgageParams
  /** Тумблер сценария слёта. По умолчанию выключен — расчёт идёт по льготной ставке. */
  slipEnabled: boolean
  result: CalculationResult
  setParam: <K extends keyof MortgageParams>(key: K, value: MortgageParams[K]) => void
  setSlipEnabled: (value: boolean) => void
  /** Месяц слёта, который реально участвует в расчёте: 0, если тумблер выключен. */
  effectiveSlipMonth: () => number
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
  slipEnabled: boolean
}

export const useCalculatorStore = create<CalculatorState>()(
  persist(
    (set, get) => ({
      params: defaultParams,
      slipEnabled: false,
      result: recalc(defaultParams, false),
      setParam: (key, value) => {
        const newParams = { ...get().params, [key]: value }
        set({ params: newParams })
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
    }),
    {
      name: 'mortgage-calculator-params',
      version: 2,
      partialize: (state) => ({ params: state.params, slipEnabled: state.slipEnabled }),
      migrate: (persisted, version): PersistedCalculatorState => {
        const prev = persisted as Partial<PersistedCalculatorState>
        if (version < 2) {
          // Старое сохранённое значение slipMonth (обычно дефолтные 36) — не осознанный
          // выбор пользователя, а дефолт слайдера. Тумблер остаётся выключенным.
          return { params: prev.params ?? defaultParams, slipEnabled: false }
        }
        return { params: prev.params ?? defaultParams, slipEnabled: prev.slipEnabled ?? false }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Защита от неполных/устаревших данных: восстанавливаем дефолты для undefined полей
          state.params = { ...defaultParams, ...state.params }
          state.slipEnabled = state.slipEnabled ?? false
          state.result = recalc(state.params, state.slipEnabled)
        }
      },
    }
  )
)
