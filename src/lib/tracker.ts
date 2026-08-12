/**
 * Расчёт текущего состояния ипотеки по данным трекера.
 * Алгоритм: §6 спеки docs/specs/2026-08-12-tracker-design.md.
 * Чистая функция — `today` обязательный аргумент, никаких `new Date()` внутри.
 */
import { calcPMT } from './engine'
import type { MortgageDto, MortgageEventDto } from '../api/types'

export interface MortgageState {
  /** Остаток долга на сегодня */
  currentBalance: number
  /** Действующая ставка, % годовых */
  currentRate: number
  /** Действующий обязательный платёж */
  currentPayment: number
  /** null — платежа не хватает даже на проценты, долг не убывает */
  monthsLeft: number | null
  /** YYYY-MM или null */
  payoffDate: string | null
  /** Погашено тела кредита */
  paidPrincipal: number
  /** paidPrincipal / principal, доля 0..1 */
  progressPct: number
  /** Дата расчёта, YYYY-MM-DD */
  asOf: string
}

function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Индекс календарного месяца: year*12 + (month-1) — удобен для арифметики */
function monthKey(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return y * 12 + (m - 1)
}

function formatMonthKey(key: number): string {
  const y = Math.floor(key / 12)
  const m = key - y * 12 + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

function sortByOccurredOn(events: MortgageEventDto[]): MortgageEventDto[] {
  return [...events].sort((a, b) => {
    if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1
    return a.id - b.id
  })
}

/**
 * Число месяцев до обнуления остатка при фиксированных ставке и платеже.
 * null — платёж не покрывает даже проценты, долг не убывает.
 */
function monthsToPayoff(balance: number, ratePctAnnual: number, payment: number): number | null {
  if (balance <= 0) return 0
  const r = ratePctAnnual / 1200
  const interest = balance * r
  if (payment <= interest) return null

  if (r === 0) return Math.ceil(balance / payment)

  const ratio = 1 - (balance * r) / payment
  if (ratio <= 0) return null

  const n = -Math.log(ratio) / Math.log(1 + r)
  return Math.max(1, Math.ceil(n - 1e-9))
}

export function computeMortgageState(
  m: MortgageDto,
  events: MortgageEventDto[],
  today: Date,
): MortgageState {
  const todayKey = toDateKey(today)
  const relevant = sortByOccurredOn(events).filter((e) => e.occurredOn <= todayKey)

  // 1. Якорь — последнее событие balance с occurredOn ≤ today, иначе principal на startedOn.
  const balanceEvents = relevant.filter((e) => e.kind === 'balance')
  const anchorEvent = balanceEvents[balanceEvents.length - 1]
  const anchorDate = anchorEvent ? anchorEvent.occurredOn : m.startedOn
  let balance = anchorEvent ? (anchorEvent.amount ?? 0) : m.principal

  // 2. Ставка на момент якоря (последнее rate с occurredOn ≤ anchorDate, иначе mortgage.rate)
  const rateBeforeAnchor = relevant.filter((e) => e.kind === 'rate' && e.occurredOn <= anchorDate)
  let rate = rateBeforeAnchor.length > 0 ? (rateBeforeAnchor[rateBeforeAnchor.length - 1].rate ?? m.rate) : m.rate

  // 3. Платёж на момент якоря (последнее payment ≤ anchorDate, иначе monthlyPayment, иначе calcPMT)
  const paymentBeforeAnchor = relevant.filter((e) => e.kind === 'payment' && e.occurredOn <= anchorDate)
  let payment =
    paymentBeforeAnchor.length > 0
      ? (paymentBeforeAnchor[paymentBeforeAnchor.length - 1].amount ?? 0)
      : (m.monthlyPayment ?? calcPMT(m.principal, rate / 1200, m.termMonths))

  // 4. Прокрутка по месяцам от якоря до today: начисление процентов, вычитание платежа,
  //    вычитание prepayment-событий месяца, применение rate/payment-событий с этого месяца.
  const futureEvents = relevant.filter((e) => e.occurredOn > anchorDate)
  const anchorMonth = monthKey(anchorDate)
  const todayMonth = monthKey(todayKey)
  const stepsCount = Math.max(0, todayMonth - anchorMonth)

  let eventIdx = 0
  for (let step = 1; step <= stepsCount; step++) {
    const stepMonth = anchorMonth + step

    const interest = balance * (rate / 1200)
    balance = Math.max(0, balance + interest - payment)

    let prepaySum = 0
    while (eventIdx < futureEvents.length && monthKey(futureEvents[eventIdx].occurredOn) <= stepMonth) {
      const e = futureEvents[eventIdx]
      if (e.kind === 'prepayment') prepaySum += e.amount ?? 0
      else if (e.kind === 'rate') rate = e.rate ?? rate
      else if (e.kind === 'payment') payment = e.amount ?? payment
      eventIdx++
    }
    balance = Math.max(0, balance - prepaySum)
  }

  // 5. monthsLeft / payoffDate — проекция вперёд при текущих ставке и платеже
  const monthsLeft = monthsToPayoff(balance, rate, payment)
  const payoffDate = monthsLeft !== null ? formatMonthKey(todayMonth + monthsLeft) : null

  const paidPrincipal = Math.max(0, m.principal - balance)
  const progressPct = m.principal > 0 ? Math.min(1, Math.max(0, paidPrincipal / m.principal)) : 0

  return {
    currentBalance: Math.round(balance * 100) / 100,
    currentRate: rate,
    currentPayment: Math.round(payment * 100) / 100,
    monthsLeft,
    payoffDate,
    paidPrincipal: Math.round(paidPrincipal * 100) / 100,
    progressPct,
    asOf: todayKey,
  }
}
