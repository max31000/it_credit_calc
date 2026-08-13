/**
 * Расчёт текущего состояния ипотеки по данным трекера и реконструкция истории долга.
 * Алгоритм состояния: §6 спеки docs/specs/2026-08-12-tracker-design.md.
 * Алгоритм истории (`buildDebtHistory`): §4 спеки docs/specs/2026-08-13-mortgage-timeline-design.md.
 * Чистые функции — `today` обязательный аргумент, никаких `new Date()` внутри.
 */
import { calcPMT } from './engine'
import type { MortgageDto, MortgageEventDto } from '../api/types'

/** Одна точка помесячного ряда истории долга: `month` 0 — месяц выдачи ипотеки */
export interface DebtHistoryPoint {
  /** Месяц от выдачи: 0 — месяц выдачи */
  month: number
  /** 'YYYY-MM' */
  yearMonth: string
  /** Остаток долга на конец месяца */
  debt: number
  /** Проценты, начисленные в этом месяце (0 для month === 0) */
  interest: number
  /** Действующая ставка в этом месяце, % годовых */
  rate: number
  /** Действующий обязательный платёж в этом месяце, ₽ */
  payment: number
}

export interface DebtHistory {
  points: DebtHistoryPoint[]
  /** points.length − 1 */
  elapsedMonths: number
  /** Σ interest по всем точкам, ₽ */
  paidInterest: number
  /** Проценты по календарным годам: { 2024: 180000, 2025: 165000 } */
  interestByYear: Record<number, number>
}

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

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Реконструирует помесячную историю долга от выдачи ипотеки до «сегодня» (§4.1 дизайна
 * docs/specs/2026-08-13-mortgage-timeline-design.md). Чистая функция; `today` — обязательный
 * аргумент, `new Date()` внутри запрещён.
 *
 * Ключевое правило: `balance`-событие — снимок из банка, он затирает расчёт, а не корректирует
 * его. Порядок обработки событий внутри месяца — по (occurredOn, id), поэтому досрочка, сделанная
 * после снимка, вычитается из него, а сделанная до — нет (уже учтена банком).
 */
export function buildDebtHistory(m: MortgageDto, events: MortgageEventDto[], today: Date): DebtHistory {
  const todayKey = toDateKey(today)
  const start = monthKey(m.startedOn)
  const last = monthKey(todayKey)
  const elapsedMonths = Math.max(0, last - start)

  const relevant = sortByOccurredOn(events).filter((e) => e.occurredOn <= todayKey)

  let balance = m.principal
  let rate = m.rate
  let payment = m.monthlyPayment ?? calcPMT(m.principal, m.rate / 1200, m.termMonths)

  const points: DebtHistoryPoint[] = new Array(elapsedMonths + 1)
  let paidInterest = 0
  const interestByYear: Record<number, number> = {}
  let ptr = 0

  for (let s = 0; s <= elapsedMonths; s++) {
    let interest = 0
    if (s > 0) {
      interest = balance * (rate / 1200)
      balance = Math.max(0, balance + interest - payment)
    }

    const stepMonth = start + s

    // «Догоняющее» применение: все события, чей месяц ≤ start + s, по порядку (occurredOn, id).
    while (ptr < relevant.length && monthKey(relevant[ptr].occurredOn) <= stepMonth) {
      const e = relevant[ptr++]
      if (e.kind === 'balance') balance = e.amount ?? balance
      else if (e.kind === 'rate') rate = e.rate ?? rate
      else if (e.kind === 'payment') payment = e.amount ?? payment
      else if (e.kind === 'prepayment') balance = Math.max(0, balance - (e.amount ?? 0))
    }

    const roundedInterest = round2(interest)
    paidInterest += roundedInterest
    const yearMonth = formatMonthKey(stepMonth)
    const year = Number(yearMonth.split('-')[0])
    interestByYear[year] = round2((interestByYear[year] ?? 0) + roundedInterest)

    points[s] = {
      month: s,
      yearMonth,
      debt: round2(balance),
      interest: roundedInterest,
      rate,
      payment: round2(payment),
    }
  }

  return { points, elapsedMonths, paidInterest: round2(paidInterest), interestByYear }
}

/**
 * Сигнатура и возвращаемый тип не меняются — реализация переписана поверх `buildDebtHistory`
 * (§4.2 дизайна): последняя точка истории тождественно равна текущему состоянию, линия таймлайна
 * не может «не сойтись» с этим числом — это конструктивно невозможно.
 */
export function computeMortgageState(
  m: MortgageDto,
  events: MortgageEventDto[],
  today: Date,
): MortgageState {
  const todayKey = toDateKey(today)
  const todayMonth = monthKey(todayKey)

  const h = buildDebtHistory(m, events, today)
  const last = h.points[h.points.length - 1]
  const balance = last.debt
  const rate = last.rate
  const payment = last.payment

  // monthsLeft / payoffDate — проекция вперёд при текущих ставке и платеже
  const monthsLeft = monthsToPayoff(balance, rate, payment)
  const payoffDate = monthsLeft !== null ? formatMonthKey(todayMonth + monthsLeft) : null

  const paidPrincipal = Math.max(0, m.principal - balance)
  const progressPct = m.principal > 0 ? Math.min(1, Math.max(0, paidPrincipal / m.principal)) : 0

  return {
    currentBalance: balance,
    currentRate: rate,
    currentPayment: payment,
    monthsLeft,
    payoffDate,
    paidPrincipal: round2(paidPrincipal),
    progressPct,
    asOf: todayKey,
  }
}
