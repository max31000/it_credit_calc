/**
 * Расчёт текущего состояния ипотеки по данным трекера и реконструкция истории долга
 * с разложением движения денег. Алгоритм состояния: §6 спеки
 * docs/specs/2026-08-12-tracker-design.md. Алгоритм истории (`buildDebtHistory`)
 * и факт-фазы (`buildMortgageFact`): §2.2, §4 спеки
 * docs/specs/2026-08-14-continuous-simulation-design.md.
 * Чистые функции — `today` обязательный аргумент, никаких `new Date()` внутри.
 */
import { calcPMT } from './engine'
import type { FactPhase } from './engine'
import type { MortgageDto, MortgageEventDto, MortgageEventKind } from '../api/types'

/** Одна точка помесячного ряда истории долга: `month` 0 — месяц выдачи ипотеки */
export interface DebtHistoryPoint {
  /** Месяц от выдачи: 0 — месяц выдачи */
  month: number
  /** 'YYYY-MM' */
  yearMonth: string
  /** Остаток на конец месяца, после применения событий этого месяца */
  debt: number
  /** Проценты, начисленные в этом месяце (0 для month === 0) */
  interest: number
  /** Обязательный платёж, фактически внесённый в этом месяце = min(payment, balance+interest) */
  scheduledPaid: number
  /** Тело, погашенное обязательным платежом = scheduledPaid − interest (может быть < 0) */
  principalPaid: number
  /** Сумма фактически применённых досрочных погашений этого месяца, ₽ */
  prepayment: number
  /** Сдвиг остатка снимком банка (со знаком): debtПослеСнимка − debtДоСнимка; 0 без снимка */
  snapshotAdjustment: number
  /** Действующая ставка в этом месяце, % годовых */
  rate: number
  /** Действующий обязательный платёж (на следующий месяц), ₽ */
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
  /** Σ scheduledPaid, ₽ */
  paidScheduled: number
  /** Σ prepayment, ₽ */
  paidPrepayments: number
  /** paidScheduled + paidPrepayments, ₽ */
  paidTotal: number
  /** Σ principalPaid + Σ prepayment = сколько тела погашено платежами, ₽ */
  principalRepaid: number
  /** Σ snapshotAdjustment, ₽ — насколько снимки банка разошлись с расчётом */
  snapshotDrift: number
  /** true — был хотя бы один balance-снимок (баланс денег сходится только с поправкой) */
  hasSnapshots: boolean
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

/** Одно событие факт-фазы для маркеров на графике */
export interface FactEvent {
  month: number
  yearMonth: string
  kind: MortgageEventKind
  /** Сумма (для prepayment/balance/payment), ₽; null для rate */
  amount: number | null
  /** Ставка (для rate), % годовых; null для остальных */
  rate: number | null
}

/**
 * Полное фактическое прошлое ипотеки: вход движка (`engine`) + всё, что нужно графикам,
 * отчётам и выводам. Чистая функция; `today` обязательный аргумент.
 */
export interface MortgageFact {
  /** Минимальный вход движка (§2.1 спеки) */
  engine: FactPhase
  /** Исходная сумма кредита при выдаче, ₽ */
  principal: number
  /** Цена и взнос по договору — реальные, ₽ */
  propertyPrice: number
  downPayment: number
  /** Ставка при выдаче, % годовых */
  originalRate: number
  /** Срок по договору, месяцев */
  termMonths: number
  /** 'YYYY-MM-DD' */
  startedOn: string
  elapsedMonths: number
  history: DebtHistory
  /** События, применённые до «сегодня», в порядке (occurredOn, id) */
  events: FactEvent[]
  /** false — текущий платёж не покрывает проценты (долг не убывает) */
  paymentCoversInterest: boolean
  /** true — срок по договору уже истёк, а долг остался */
  termExpired: boolean
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

/** События, применённые до «сегодня» (включительно), в порядке (occurredOn, id) */
function relevantEvents(events: MortgageEventDto[], todayKey: string): MortgageEventDto[] {
  return sortByOccurredOn(events).filter((e) => e.occurredOn <= todayKey)
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
 * Реконструирует помесячную историю долга от выдачи ипотеки до «сегодня» с разложением
 * движения денег (§4.1 спеки docs/specs/2026-08-14-continuous-simulation-design.md).
 * Чистая функция; `today` — обязательный аргумент, `new Date()` внутри запрещён.
 *
 * Правила:
 * - обязательный платёж месяца = min(payment, balance+interest) — не больше полного закрытия;
 * - `balance`-событие — снимок из банка, он затирает расчёт, а не корректирует его;
 * - порядок обработки событий внутри месяца — по (occurredOn, id): досрочка, сделанная после
 *   снимка, вычитается из него, а сделанная до — нет (уже учтена банком).
 *
 * `paidInterest` и `interestByYear` накапливаются в неокруглённых величинах,
 * `round2` применяется один раз в конце (§4.3 спеки) — уменьшает накопленную ошибку.
 */
export function buildDebtHistory(m: MortgageDto, events: MortgageEventDto[], today: Date): DebtHistory {
  const todayKey = toDateKey(today)
  const start = monthKey(m.startedOn)
  const last = monthKey(todayKey)
  const elapsedMonths = Math.max(0, last - start)

  const relevant = relevantEvents(events, todayKey)

  let balance = m.principal
  let rate = m.rate
  let payment = m.monthlyPayment ?? calcPMT(m.principal, m.rate / 1200, m.termMonths)

  const points: DebtHistoryPoint[] = new Array(elapsedMonths + 1)
  let paidInterestRaw = 0
  let paidScheduledRaw = 0
  let paidPrepaymentsRaw = 0
  let principalRepaidRaw = 0
  let snapshotDriftRaw = 0
  let hasSnapshots = false
  const interestByYearRaw: Record<number, number> = {}
  let ptr = 0

  for (let s = 0; s <= elapsedMonths; s++) {
    let interest = 0
    let scheduledPaid = 0
    let principalPaid = 0
    if (s > 0) {
      interest = balance * (rate / 1200)
      scheduledPaid = Math.min(payment, balance + interest)
      principalPaid = scheduledPaid - interest
      balance = balance + interest - scheduledPaid
    }

    const stepMonth = start + s
    let prepayment = 0
    let snapshotAdjustment = 0

    // «Догоняющее» применение: все события, чей месяц ≤ start + s, по порядку (occurredOn, id).
    while (ptr < relevant.length && monthKey(relevant[ptr].occurredOn) <= stepMonth) {
      const e = relevant[ptr++]
      if (e.kind === 'balance') {
        const newBalance = e.amount ?? balance
        snapshotAdjustment += newBalance - balance
        balance = newBalance
        hasSnapshots = true
      } else if (e.kind === 'prepayment') {
        const applied = Math.min(e.amount ?? 0, balance)
        prepayment += applied
        balance -= applied
      } else if (e.kind === 'rate') {
        rate = e.rate ?? rate
      } else if (e.kind === 'payment') {
        payment = e.amount ?? payment
      }
    }

    paidInterestRaw += interest
    paidScheduledRaw += scheduledPaid
    paidPrepaymentsRaw += prepayment
    principalRepaidRaw += principalPaid + prepayment
    snapshotDriftRaw += snapshotAdjustment

    const yearMonth = formatMonthKey(stepMonth)
    const year = Number(yearMonth.split('-')[0])
    interestByYearRaw[year] = (interestByYearRaw[year] ?? 0) + interest

    points[s] = {
      month: s,
      yearMonth,
      debt: round2(balance),
      interest: round2(interest),
      scheduledPaid: round2(scheduledPaid),
      principalPaid: round2(principalPaid),
      prepayment: round2(prepayment),
      snapshotAdjustment: round2(snapshotAdjustment),
      rate,
      payment: round2(payment),
    }
  }

  const interestByYear: Record<number, number> = {}
  for (const [y, v] of Object.entries(interestByYearRaw)) interestByYear[Number(y)] = round2(v)

  return {
    points,
    elapsedMonths,
    paidInterest: round2(paidInterestRaw),
    interestByYear,
    paidScheduled: round2(paidScheduledRaw),
    paidPrepayments: round2(paidPrepaymentsRaw),
    paidTotal: round2(paidScheduledRaw + paidPrepaymentsRaw),
    principalRepaid: round2(principalRepaidRaw),
    snapshotDrift: round2(snapshotDriftRaw),
    hasSnapshots,
  }
}

/**
 * Сигнатура и возвращаемый тип не меняются — реализация переписана поверх `buildDebtHistory`
 * (§4.2 дизайна фазы 5): последняя точка истории тождественно равна текущему состоянию, линия
 * таймлайна не может «не сойтись» с этим числом — это конструктивно невозможно.
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

/**
 * Строит полное фактическое прошлое ипотеки — вход прогноза движка (`FactPhase`) плюс всё,
 * что нужно графикам, отчётам и выводам (§2.2 спеки docs/specs/2026-08-14-continuous-simulation-design.md).
 *
 * Остаток срока — факт из договора (`termMonths − elapsedMonths`), а не проекция погашения:
 * прежняя реализация проецировала остаточный срок при текущем платеже, что задваивало эффект
 * прошлых досрочек (они уже уменьшили `debt`, и брать из-за них ещё и укороченный срок — значит
 * применить их эффект дважды). Проекция (`monthsToPayoff`) используется только запасным
 * вариантом, когда срок по договору уже истёк, а долг остался.
 */
export function buildMortgageFact(m: MortgageDto, events: MortgageEventDto[], today: Date): MortgageFact {
  const todayKey = toDateKey(today)
  const start = monthKey(m.startedOn)

  const h = buildDebtHistory(m, events, today)
  const last = h.points[h.points.length - 1]
  const debt = last.debt
  const rate = last.rate
  const payment = last.payment

  const contractLeft = m.termMonths - h.elapsedMonths
  const remainingMonths = contractLeft > 0 ? contractLeft : (monthsToPayoff(debt, rate, payment) ?? 1)

  const monthNumber = today.getMonth() + 1
  const taxSettleOffset = (12 - monthNumber) % 12
  const currentYear = today.getFullYear()

  const interestNow = debt * (rate / 1200)
  const paymentCoversInterest = debt <= 0 || payment > interestNow
  const termExpired = contractLeft <= 0 && debt > 0

  const events_: FactEvent[] = relevantEvents(events, todayKey).map((e) => ({
    month: monthKey(e.occurredOn) - start,
    yearMonth: formatMonthKey(monthKey(e.occurredOn)),
    kind: e.kind,
    amount: e.kind === 'rate' ? null : (e.amount ?? null),
    rate: e.kind === 'rate' ? (e.rate ?? null) : null,
  }))

  return {
    engine: {
      debt,
      rate,
      payment,
      remainingMonths,
      paidInterest: h.paidInterest,
      paidTotal: h.paidTotal,
      taxSettleOffset,
      currentYear,
    },
    principal: m.principal,
    propertyPrice: m.propertyPrice,
    downPayment: m.downPayment,
    originalRate: m.rate,
    termMonths: m.termMonths,
    startedOn: m.startedOn,
    elapsedMonths: h.elapsedMonths,
    history: h,
    events: events_,
    paymentCoversInterest,
    termExpired,
  }
}
