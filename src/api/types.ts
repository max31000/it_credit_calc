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
}

/** Тело POST /api/mortgages/{id}/events */
export interface MortgageEventRequest {
  kind: MortgageEventKind
  occurredOn: string
  amount: number | null
  rate: number | null
  note: string | null
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
