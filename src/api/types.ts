/**
 * TS-типы API трекера ипотек — дословно по §3 спеки
 * docs/specs/2026-08-12-tracker-design.md.
 */

export type MortgageEventKind = 'balance' | 'rate' | 'prepayment' | 'payment'

export interface MortgageDto {
  id: number
  title: string
  bank: string | null
  propertyPrice: number
  downPayment: number
  principal: number
  rate: number
  termMonths: number
  startedOn: string // YYYY-MM-DD
  monthlyPayment: number | null
  createdAt: string // ISO-8601 UTC
  updatedAt: string // ISO-8601 UTC
  /** Уже израсходованная база имущественного вычета, ₽ (§2.5, §7.2 дизайна) */
  usedPropertyBase: number
  /** Уже израсходованная база вычета по ипотечным процентам, ₽ */
  usedInterestBase: number
}

export interface MortgageEventDto {
  id: number
  mortgageId: number
  kind: MortgageEventKind
  occurredOn: string // YYYY-MM-DD
  amount: number | null
  rate: number | null
  note: string | null
  createdAt: string // ISO-8601 UTC
}

/** Ответ GET /api/mortgages/{id} — ипотека вместе с историей корректировок */
export interface MortgageDetails {
  mortgage: MortgageDto
  events: MortgageEventDto[]
}

/** Тело POST/PUT /api/mortgages */
export interface MortgageRequest {
  title: string
  bank: string | null
  propertyPrice: number
  downPayment: number
  principal: number
  rate: number
  termMonths: number
  startedOn: string
  monthlyPayment: number | null
  /** Уже израсходованная база имущественного вычета, ₽ (0…min(2 000 000, propertyPrice)) */
  usedPropertyBase: number
  /** Уже израсходованная база вычета по ипотечным процентам, ₽ (0…3 000 000) */
  usedInterestBase: number
}

/** Тело POST /api/mortgages/{id}/events */
export interface MortgageEventRequest {
  kind: MortgageEventKind
  occurredOn: string
  amount: number | null
  rate: number | null
  note: string | null
}

/** Семь полей, живущих в аккаунте (С3 спеки, §2.5 дизайна таймлайна), а не в сценарии калькулятора */
export interface AccountSettings {
  salary: number | null
  depositRate: number
  freeMonthly: number
  horizonYears: number
  keyRate: number
  bankDiscount: number
  /** Текущие накопления сверх кредита на «сегодня», ₽ */
  startingSavings: number
}

/** Ответ GET/PUT /api/profile/settings. settings === null — пользователь ещё не сохранял. */
export interface UserSettingsResponse {
  version: number
  settings: AccountSettings | null
  updatedAt: string | null // ISO-8601 UTC
}

export interface AuthUser {
  id: number
  telegramId: number
  username?: string | null
  firstName?: string | null
  lastName?: string | null
}

export interface AuthResponse {
  token: string
  user: AuthUser
}
