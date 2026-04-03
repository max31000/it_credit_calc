import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { startTransition } from 'react'
import { calculate, type MortgageParams, type CalculationResult } from '../lib/engine'

interface CalculatorState {
  params: MortgageParams
  result: CalculationResult
  setParam: <K extends keyof MortgageParams>(key: K, value: MortgageParams[K]) => void
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

export const useCalculatorStore = create<CalculatorState>()(
  persist(
    (set, get) => ({
      params: defaultParams,
      result: calculate(defaultParams),
      setParam: (key, value) => {
        const newParams = { ...get().params, [key]: value }
        set({ params: newParams })
        startTransition(() => {
          set({ result: calculate(newParams) })
        })
      },
    }),
    {
      name: 'mortgage-calculator-params',
      version: 1,
      partialize: (state) => ({ params: state.params }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Защита от неполных/устаревших данных: восстанавливаем дефолты для undefined полей
          state.params = { ...defaultParams, ...state.params }
          state.result = calculate(state.params)
        }
      },
    }
  )
)
