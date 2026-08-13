/**
 * Маппинг «ипотека из трекера → MortgageParams» (§2.5 спеки
 * docs/specs/2026-08-14-continuous-simulation-design.md). Чистая функция — `today` обязательный
 * аргумент, никаких `new Date()` внутри (как в `tracker.ts`).
 */
import type { MortgageParams } from './engine'
import type { AccountSettings, MortgageDto, MortgageEventDto } from '../api/types'
import { computeMortgageState, buildMortgageFact, type MortgageState, type MortgageFact } from './tracker'

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
  /** Полное фактическое прошлое ипотеки — вход движка + данные для графиков и отчётов */
  fact: MortgageFact
  /** true — текущий платёж не покрывает проценты (долг не убывает) */
  termFallback: boolean
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Извлекает семь полей аккаунта из активных `MortgageParams` — общий хелпер
 *  для мест, которым нужно передать «текущие настройки аккаунта» в `mortgageToParams`. */
export function accountSettingsFromParams(p: MortgageParams): AccountSettings {
  return {
    salary: p.salary,
    depositRate: p.depositRate,
    freeMonthly: p.freeMonthly,
    horizonYears: p.horizonYears,
    keyRate: p.keyRate,
    bankDiscount: p.bankDiscount,
    startingSavings: p.startingSavings,
  }
}

/**
 * `params.slipMonth` здесь не осмысленный — вызывающий код (`store.enterMortgageMode`)
 * подставляет вместо него `ownParams.slipMonth` (слёт — гипотеза пользователя, а не факт
 * из трекера, см. §2.5 спеки), поэтому значение ниже — просто безопасный дефолт.
 *
 * Движок берёт сумму кредита, ставку, платёж и остаток срока из `fact.engine` напрямую
 * (`calculate(params, fact.engine)`) — `downPayment`/`itRate`/`termYears` на прогноз
 * не влияют (§11 И7 спеки). Здесь они нужны только для отображения (карточка фактов)
 * и как граница слайдера слёта.
 */
export function mortgageToParams(input: MortgageModeParamsInput): MortgageModeParams {
  const { mortgage, events, settings, today } = input
  const state = computeMortgageState(mortgage, events, today)
  const fact = buildMortgageFact(mortgage, events, today)

  // Только для границы слайдера слёта — остаток срока берётся из договора (не из проекции,
  // проекция уже задваивала бы эффект прошлых досрочек, см. tracker.buildMortgageFact).
  const termYears = clamp(Math.ceil(fact.engine.remainingMonths / 12), 1, 30)
  const termFallback = !fact.paymentCoversInterest

  const params: MortgageParams = {
    apartmentPrice: mortgage.propertyPrice,
    // Реальный первоначальный взнос по договору — не синтетический (D1 диагноза спеки).
    downPayment: mortgage.downPayment,
    itRate: fact.engine.rate,
    termYears,
    freeMonthly: settings.freeMonthly,
    depositRate: settings.depositRate,
    // Без клампа сроком ипотеки (§7.4 спеки) — горизонт сравнения, а не срок кредита.
    horizonYears: settings.horizonYears,
    slipMonth: 0,
    keyRate: settings.keyRate,
    bankDiscount: settings.bankDiscount,
    salary: settings.salary,
    startingSavings: settings.startingSavings,
    usedPropertyBase: mortgage.usedPropertyBase,
    usedInterestBase: mortgage.usedInterestBase,
  }

  return { params, state, fact, termFallback }
}
