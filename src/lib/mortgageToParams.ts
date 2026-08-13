/**
 * Маппинг «ипотека из трекера → MortgageParams» (§2 спеки
 * docs/specs/2026-08-12-tracker-ux-design.md). Чистая функция — `today` обязательный
 * аргумент, никаких `new Date()` внутри (как в `tracker.ts`).
 */
import type { MortgageParams } from './engine'
import type { AccountSettings, MortgageDto, MortgageEventDto } from '../api/types'
import { computeMortgageState, type MortgageState } from './tracker'

export interface MortgageModeParamsInput {
  mortgage: MortgageDto
  events: MortgageEventDto[]
  /** Настройки аккаунта (С3) — подмешиваются как есть */
  settings: AccountSettings
  today: Date
}

export interface MortgageModeParams {
  params: MortgageParams
  state: MortgageState
  /** true — monthsLeft === null, срок взят из планового графика (допущение 4) */
  termFallback: boolean
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Извлекает шесть полей аккаунта (С3) из активных `MortgageParams` — общий хелпер
 *  для мест, которым нужно передать «текущие настройки аккаунта» в `mortgageToParams`. */
export function accountSettingsFromParams(p: MortgageParams): AccountSettings {
  return {
    salary: p.salary,
    depositRate: p.depositRate,
    freeMonthly: p.freeMonthly,
    horizonYears: p.horizonYears,
    keyRate: p.keyRate,
    bankDiscount: p.bankDiscount,
  }
}

/** Индекс календарного месяца: year*12 + (month-1) — та же арифметика, что в tracker.ts */
function monthKey(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return y * 12 + (m - 1)
}

/**
 * `params.slipMonth` здесь не осмысленный — вызывающий код (`store.enterMortgageMode`)
 * подставляет вместо него `ownParams.slipMonth` (слёт — гипотеза пользователя, а не факт
 * из трекера, см. допущение 6 §2 спеки), поэтому значение ниже — просто безопасный дефолт.
 */
export function mortgageToParams(input: MortgageModeParamsInput): MortgageModeParams {
  const { mortgage, events, settings, today } = input
  const state = computeMortgageState(mortgage, events, today)

  const termFallback = state.monthsLeft === null
  let termYears: number
  if (!termFallback) {
    termYears = clamp(Math.round((state.monthsLeft as number) / 12), 1, 30)
  } else {
    // Допущение 4: платёж не покрывает проценты — берём плановый остаточный срок.
    const startMonth = monthKey(mortgage.startedOn)
    const todayMonth = monthKey(state.asOf)
    const elapsedMonths = Math.max(0, todayMonth - startMonth)
    const remainingPlannedMonths = mortgage.termMonths - elapsedMonths
    termYears = clamp(Math.round(remainingPlannedMonths / 12), 1, 30)
  }

  // Допущение 1: downPayment — синтетический. loanAmount = apartmentPrice − downPayment,
  // подставляя downPayment = propertyPrice − остаток, получаем loanAmount === остаток долга.
  const downPayment = clamp(Math.round(mortgage.propertyPrice - state.currentBalance), 0, mortgage.propertyPrice)

  const params: MortgageParams = {
    apartmentPrice: mortgage.propertyPrice,
    downPayment,
    itRate: state.currentRate,
    termYears,
    freeMonthly: settings.freeMonthly,
    depositRate: settings.depositRate,
    horizonYears: Math.min(settings.horizonYears, termYears),
    slipMonth: 0,
    keyRate: settings.keyRate,
    bankDiscount: settings.bankDiscount,
    salary: settings.salary,
  }

  return { params, state, termFallback }
}
