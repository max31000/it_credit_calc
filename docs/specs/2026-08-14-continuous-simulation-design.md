# Непрерывная симуляция ипотеки от даты выдачи — дизайн

Дата: 2026-08-14. Статус: к реализации. Фаза 6.
Отменяет и заменяет модель режима ипотеки из `docs/specs/2026-08-13-mortgage-timeline-design.md`
(фаза 5). Всё, что не касается режима ипотеки (гостевой расчёт, трекер, авторизация, деплой),
из фазы 5 остаётся в силе.

**§2 (контракт типов) — замороженный источник правды для исполнителей A, B, C.
Расхождение с §2 = баг, а не свобода реализации.**

---

## 0. Запрос владельца и диагноз

Дословно:

> Рассчёты всё ещё кривые. Ты в калькуляторе просто манипулируешь вводными данными чтобы сумму
> кредита уровнять с остатком по кредиту. А ты должен показывать движение денег и частичные
> закрытия и до сегодняшнего дня. Сделай это нормально и правильно, а не быстро.

### 0.1. Диагноз подтверждён кодом

`src/lib/mortgageToParams.ts:74-93` — дословно:

```ts
// Допущение 1: downPayment — синтетический. loanAmount = apartmentPrice − downPayment,
// подставляя downPayment = propertyPrice − остаток, получаем loanAmount === остаток долга.
const downPayment = clamp(Math.round(mortgage.propertyPrice - state.currentBalance), 0, mortgage.propertyPrice)
```

Из этого следуют **шесть** дефектов, а не один:

| # | Дефект | Где видно |
|---|--------|-----------|
| **D1** | Пользователю в параметрах показывается синтетический первоначальный взнос (цена − остаток), никак не связанный с реально внесённым | `ParamsSection`, слайдер «Первоначальный взнос» |
| **D2** | Движок считает прогноз как **новый кредит**, взятый сегодня: `loanAmount = price − downPayment`, `n = termYears × 12`, `pmt = calcPMT(loanAmount, itRate, n)` (`engine.ts:365-376`) | вся математика прогноза |
| **D3** | Срок округляется до целых лет (`clamp(round(monthsLeft/12), 1, 30)`), поэтому расчётный платёж не сходится с фактическим — и в баннере стоит извинение за это | `MortgageModeBanner.ASSUMPTIONS_TEXT` |
| **D4** | «Переплата по графику», «уплачено всего», «уплачено процентов» считаются **только от сегодня**; всё, что заёмщик уже отдал банку, в цифрах отсутствует | `InsightsSection`, `MetricCard` |
| **D5** | Частичные досрочные погашения прошлого нигде не видны как движение денег: `LinkedMortgage.history` — только ряд остатков, из него нельзя отличить «платил по графику» от «внёс 800 тысяч» | графики |
| **D6** | Налоговые годы движка — это «каждые 12 месяцев от сегодня», а не календарные годы; при этом фактические проценты прошлых лет (`interestByYear`) уже посчитаны и **не используются** прогнозом | вычеты |

Плюс два системных следствия:
* `horizonYears = min(settings.horizonYears, termYears)` — ипотека с двумя годами до погашения
  насильно ужимает горизонт сравнения до двух лет и уничтожает сам смысл сравнения стратегий;
* прошлое приклеено к графику чисто визуально (`timeline.ts` склеивает `series` и ряд остатков),
  поэтому «стык» держится на договорённости, а не на общей симуляции.

### 0.2. Что именно требуется

Не «дорисовать прошлое», а **перестать выдумывать вводные**: движок должен получать фактическое
состояние кредита как явный вход, а не реконструировать его подгонкой `downPayment`.

---

## 1. Модель: одна непрерывная серия от выдачи

```
   выдача                                 сегодня                        горизонт
     │                                       │                               │
     ├───────────── ФАКТ-ФАЗА ───────────────┼──────── ПРОГНОЗ-ФАЗА ─────────┤
     │  события трекера, реальные платежи,   │  две стратегии из фактического │
     │  проценты, досрочки, снимки банка     │  состояния                     │
     │                                       │                               │
   month 0                              month = elapsed                  elapsed+horizon
```

### 1.1. Факт-фаза (месяцы 0…elapsed)

Единственная реализация — `tracker.buildDebtHistory` (уже существует, §4 фазы 5). Она
расширяется до **разложения движения денег** по месяцам: проценты, тело, погашенное обязательным
платежом, досрочки, корректировка снимком банка.

Правила остаются прежними и корректными:
* обязательный платёж вносится каждый месяц; ставка и платёж меняются `rate`/`payment`-событиями
  начиная с месяца события;
* `prepayment` уменьшает остаток в конце месяца события, до начисления процентов следующего месяца;
* `balance`-событие — **снимок из банка, он затирает расчёт**, а не корректирует его;
  порядок внутри месяца — по `(occurredOn, id)`.

### 1.2. Прогноз-фаза (месяцы elapsed…elapsed+horizon)

Обе стратегии стартуют **из фактического состояния**:

| Что | Откуда |
|---|---|
| остаток долга | `fact.debt` — последняя точка факт-фазы |
| ставка | `fact.rate` — действующая на сегодня |
| обязательный платёж | `fact.payment` — действующий на сегодня (не пересчитанный аннуитет!) |
| остаток срока | `fact.remainingMonths` — по договору, в **месяцах**, без округления до лет |
| накопления | `params.startingSavings` |
| база имущественного вычета | `min(2 млн, apartmentPrice) − usedPropertyBase` |
| база вычета по процентам | `3 млн − usedInterestBase` |
| незаявленные проценты | `max(0, fact.paidInterest − usedInterestBase)` — переносятся в пул первого года |
| граница налогового года | конец **календарного** года |

Никаких синтетических цен и взносов: `apartmentPrice` нужен ровно для лимита имущественного
вычета и для отображения, `downPayment` — только для отображения. **Движок их для суммы кредита
не использует, когда факт-фаза передана** (это проверяется тестом, §11 И7).

### 1.3. Единый источник истины прокрутки — решение

Требование: не допустить двух реализаций одной прокрутки.

Рассмотрены:

| Вариант | Вердикт |
|---|---|
| Движок симулирует и прошлое тоже (общая петля) | **Отвергнут.** Прошлое событийно-детерминировано и одинаково для обеих стратегий; протаскивание дат и `MortgageEventDto` в `engine.ts` разворачивает стрелку зависимостей (`tracker → engine`) и даёт гостю мёртвый код. Кроме того, `slipAnalysis`/`safetyMonth` немедленно теряют единицы измерения |
| Трекер переиспользует петлю движка | **Отвергнут.** Петля движка — политика («весь бюджет в долг» / «минимум + вклад»), у факт-фазы политики нет: там есть события. Общего кода получилось бы 3 строки при 40 строках адаптеров |
| **Движок принимает готовое стартовое состояние (`FactPhase`) от трекера и продолжает ту же серию** | **Принят** |

Почему это и есть «одна прокрутка», а не две: месячный примитив (`interest = debt × r`,
`debt += interest − payment`) в каждой фазе применяется **к своему набору правил**, и правила
разные по природе. Дублирования нет, потому что дублировать нечего: совпадает одна формула
начисления процентов, и она уже вынесена — `calcPMT`/`r = rate/1200` живут в `engine.ts`,
`tracker.ts` их импортирует. Непрерывность обеспечивается не общим кодом, а **общим состоянием**:
`series[0]` прогноза тождественно равен последней точке факта — конструктивно, потому что это
буквально одни и те же числа, переданные аргументом.

Стрелки зависимостей (не меняются):

```
engine.ts   ──────► (ничего)
tracker.ts  ──────► engine.ts            (calcPMT)
timeline.ts ──────► engine.ts, tracker.ts (только типы)
reporting.ts ─────► engine.ts, tracker.ts (только типы)
mortgageToParams ─► engine.ts, tracker.ts
```

`engine.ts` по-прежнему **не знает про даты**: `FactPhase` содержит только скаляры
(включая `taxSettleOffset` и `currentYear` — числа, не `Date`).

---

## 2. Контракт типов (заморожен)

### 2.1. `src/lib/engine.ts`

```ts
/**
 * Фактическое состояние ипотеки на «сегодня» — вход прогноза.
 * Строится трекером (`buildMortgageFact`), движок его только читает и не знает про даты.
 * null — гостевой сценарий: кредит берётся сейчас, прошлого нет.
 */
export interface FactPhase {
  /** Остаток долга на «сегодня», ₽ — стартовая точка прогноза */
  debt: number
  /** Действующая ставка на «сегодня», % годовых */
  rate: number
  /** Действующий обязательный платёж на «сегодня», ₽ */
  payment: number
  /** Остаток срока на «сегодня», месяцев; всегда ≥ 1 */
  remainingMonths: number
  /** Уплачено процентов с выдачи до «сегодня», ₽ */
  paidInterest: number
  /** Внесено банку с выдачи до «сегодня» (обязательные платежи + досрочки), ₽ */
  paidTotal: number
  /** Месяцев от «сегодня» до конца текущего календарного года, 0…11 */
  taxSettleOffset: number
  /** Календарный год «сегодня» — метка для TaxInfo.byYear[].calendarYear */
  currentYear: number
}

export interface MonthlyPoint {
  // …девять существующих полей без изменений…
  /** Проценты, начисленные в этом месяце, стратегия «гасить досрочно», ₽ */
  interestPrepay: number
  /** Проценты, начисленные в этом месяце, стратегия «копить», ₽ */
  interestSave: number
}

export interface StrategyResult {
  // …восемь существующих полей без изменений…
  /** Уплачено банку с выдачи ипотеки: факт + прогноз, ₽ (без факт-фазы === totalPaid) */
  totalPaidWithFact: number
  /** Уплачено процентов с выдачи ипотеки: факт + прогноз, ₽ (без факт-фазы === totalInterest) */
  totalInterestWithFact: number
}

export interface TaxInfo {
  // …существующие поля без изменений…
  byYear: Array<{
    /** Порядковый год прогноза, 1…N (как раньше) */
    year: number
    amount: number
    propertyReturn: number
    /** Календарный год; null — гостевой сценарий (календаря нет) */
    calendarYear: number | null
  }>
}

/**
 * `fact === null | undefined` — гостевой сценарий, поведение побайтово прежнее.
 * `fact !== null` — прогноз продолжает фактическую ипотеку: сумма кредита, ставка,
 * платёж и остаток срока берутся из `fact`, а `downPayment`, `itRate`, `termYears`
 * движком НЕ используются (см. §11 И7).
 */
export function calculate(params: MortgageParams, fact?: FactPhase | null): CalculationResult
```

`MortgageParams` **не меняется** (те же 15 полей, что и сейчас). `CalculationResult` на верхнем
уровне не меняется; меняется **семантика двух полей**:

| Поле | Гость | Режим ипотеки |
|---|---|---|
| `loanAmount` | `apartmentPrice − downPayment` | `fact.debt` — остаток, с которого стартует прогноз |
| `minPayment` | `round(calcPMT(loanAmount, itRate, n))` | `round(fact.payment)` — фактический платёж по договору |
| `totalInterest` | `round(pmt × n − loanAmount)` | `round(fact.paidInterest + max(0, fact.payment × remainingMonths − fact.debt))` |

Обе формулы `totalInterest` — **одно выражение**: `round(factInterest + max(0, pmt × months − debt))`,
где для гостя `factInterest = 0`, а `max(0, …)` — тождественный no-op. Байтовая совместимость
гостя следует из этого конструктивно, а не из аккуратности.

### 2.2. `src/lib/tracker.ts`

```ts
export interface DebtHistoryPoint {
  month: number
  yearMonth: string           // 'YYYY-MM'
  /** Остаток на конец месяца, после применения событий этого месяца */
  debt: number
  /** Проценты, начисленные в этом месяце (0 для month === 0) */
  interest: number
  /** Обязательный платёж, фактически внесённый в этом месяце = min(payment, debt+interest) */
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
  elapsedMonths: number        // points.length − 1
  paidInterest: number
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

/** Не меняется */
export function buildDebtHistory(m: MortgageDto, events: MortgageEventDto[], today: Date): DebtHistory

/** Не меняются ни сигнатура, ни MortgageState */
export function computeMortgageState(m: MortgageDto, events: MortgageEventDto[], today: Date): MortgageState

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
  /** Минимальный вход движка (§2.1) */
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

export function buildMortgageFact(m: MortgageDto, events: MortgageEventDto[], today: Date): MortgageFact
```

Правила вычисления полей `FactPhase` внутри `buildMortgageFact`:

```
h              = buildDebtHistory(m, events, today)
last           = h.points.at(-1)
debt           = last.debt
rate           = last.rate
payment        = last.payment
contractLeft   = m.termMonths − h.elapsedMonths
remainingMonths = contractLeft > 0
                    ? contractLeft
                    : (monthsToPayoff(debt, rate, payment) ?? 1)      // срок вышел, долг остался
paidInterest   = h.paidInterest
paidTotal      = h.paidTotal
taxSettleOffset = (12 − monthNumber(today)) % 12                      // 2026-08 → 4; 2026-12 → 0
currentYear     = year(today)
```

**Остаток срока — факт из договора, а не проекция.** Прежняя реализация брала
`monthsToPayoff(...)` (проекцию погашения при текущем платеже) и округляла её до лет. Это
двойной учёт: досрочки прошлого уже уменьшили `debt`, и брать из-за них ещё и укороченный срок —
значит применить их эффект дважды. Проекция остаётся только на странице трекера
(`MortgageState.payoffDate`) и как запасной вариант, когда срок по договору уже истёк.

### 2.3. `src/lib/timeline.ts`

```ts
export interface TimelinePoint {
  month: number                 // абсолютный: 0 — месяц выдачи
  debtFact: number | null
  netWorthFact: number | null
  debtPrepay: number | null
  debtSave: number | null
  savingsSave: number | null
  netWorthPrepay: number | null
  netWorthSave: number | null
}

export interface TimelineMarker {
  month: number
  kind: MortgageEventKind
  amount: number | null
  rate: number | null
  yearMonth: string
}

export interface Timeline {
  hasFact: boolean
  todayMonth: number
  points: TimelinePoint[]
  slipPoints: SlipTimelinePoint[]   // без изменений
  startedOn: string | null
  /** Маркеры событий прошлого для ReferenceDot — только prepayment и rate */
  markers: TimelineMarker[]
}

/** Сигнатура изменена: вместо (result, history: number[] | null, startedOn) */
export function buildTimeline(result: CalculationResult, fact: MortgageFact | null): Timeline

// toAbsolute / sliceFromToday / absoluteMonthLabel — без изменений
```

Правила склейки не меняются (§2.3 фазы 5): до `todayMonth` заполнен только факт, после — только
прогноз, в `todayMonth` заполнено всё. `markers` содержит только события с `kind === 'prepayment'`
и `kind === 'rate'` (снимки и смены платежа на графике не рисуем — они не движение денег).

### 2.4. `src/lib/reporting.ts` (новый файл)

```ts
export type YearKind = 'fact' | 'mixed' | 'forecast'

export interface CashFlowYear {
  /** Календарный год в режиме ипотеки; порядковый год прогноза (1…N) у гостя */
  year: number
  kind: YearKind
  /** Проценты за год, ₽ */
  interest: number
  /** Тело, погашенное обязательными платежами, ₽ */
  principal: number
  /** Досрочные погашения (у прогноза — всё, что внесено сверх обязательного платежа), ₽ */
  prepayment: number
  /** interest + principal + prepayment */
  total: number
}

/**
 * Движение денег по годам: факт-фаза из `fact.history`, прогноз — из `result.series`
 * выбранной стратегии. Месячный платёж прогноза восстанавливается как
 * `interest + (debt[t−1] − debt[t])`, поэтому дополнительных полей движку не требуется.
 */
export function buildCashFlow(
  result: CalculationResult, fact: MortgageFact | null, strategy: 'prepay' | 'save',
): CashFlowYear[]

export type DeductionStatus = 'claimed' | 'partial' | 'forecast' | 'noBase'

export interface DeductionYear {
  year: number
  kind: YearKind
  /** Проценты, уплаченные за этот год (факт и/или прогноз), ₽ */
  interestPaid: number
  status: DeductionStatus
  /** Возврат за год: прошлое — оценка по израсходованной базе, будущее — из TaxInfo, ₽ */
  refund: number
  /** Имущественная часть возврата (только прогнозные строки), ₽ */
  propertyRefund: number
}

export interface DeductionReport {
  rows: DeductionYear[]
  /**
   * Последний календарный год, проценты по который полностью укладываются
   * в `params.usedInterestBase`. null — база не введена или факта нет.
   * ВЫВОДИТСЯ, не хранится (см. §6.2).
   */
  claimedThroughYear: number | null
  /** Остаток базы имущественного вычета на сегодня, ₽ (= result.tax.propertyBaseStart) */
  propertyBaseLeft: number
  /** Остаток базы вычета по процентам на сегодня, ₽ */
  interestBaseLeft: number
}

export function buildDeductionReport(
  result: CalculationResult, fact: MortgageFact | null, params: MortgageParams,
): DeductionReport | null            // null при salary === null
```

### 2.5. `src/lib/mortgageToParams.ts`

```ts
export interface MortgageModeParams {
  params: MortgageParams
  state: MortgageState
  fact: MortgageFact
  /** true — текущий платёж не покрывает проценты (переименованный смысл, см. §2.2) */
  termFallback: boolean
}
```

Новая таблица маппинга (жирным — то, что изменилось):

| `MortgageParams` | Источник |
|---|---|
| `apartmentPrice` | `mortgage.propertyPrice` |
| **`downPayment`** | **`mortgage.downPayment` — реальный взнос, больше не синтетический** |
| `itRate` | `fact.engine.rate` (обязан совпадать — §11 И8) |
| **`termYears`** | **`ceil(fact.engine.remainingMonths / 12)`, clamp [1, 30] — только для границы слайдера слёта** |
| **`horizonYears`** | **`settings.horizonYears` — без клампа сроком (§7.3)** |
| `freeMonthly`, `depositRate`, `keyRate`, `bankDiscount`, `salary`, `startingSavings` | `settings` |
| `slipMonth` | `0` (подменяется вызывающим кодом на `ownParams.slipMonth`) |
| `usedPropertyBase`, `usedInterestBase` | `mortgage` |

### 2.6. `src/store/useCalculatorStore.ts`

```ts
export interface LinkedMortgage {
  id: number
  title: string
  asOf: string
  balance: number
  payment: number
  rate?: number
  termFallback: boolean
  startedOn?: string
  /** Исходная сумма кредита, ₽ — для баннера, пока факт грузится */
  principal?: number
  /** Уплачено процентов, ₽ — для баннера, пока факт грузится */
  paidInterest?: number
  /** Месяцев с выдачи — для баннера, пока факт грузится */
  elapsedMonths?: number
}
```

Поля `history?: number[]` **удаляются** из персиста.

```ts
interface CalculatorState {
  params: MortgageParams
  ownParams: MortgageParams
  slipEnabled: boolean
  linkedMortgage: LinkedMortgage | null      // персистится
  /** НЕ персистится: пересобирается из данных сервера при каждом входе на страницу */
  mortgageFact: MortgageFact | null
  /** Текст ошибки загрузки факта; null — ошибки нет */
  factError: string | null
  result: CalculationResult

  setParam / setParams / setSlipEnabled / effectiveSlipMonth   // без изменений
  /** Сигнатура расширена третьим аргументом */
  enterMortgageMode: (link: LinkedMortgage, params: MortgageParams, fact: MortgageFact) => void
  exitMortgageMode: () => void
  applyAccountSettings: (s: AccountSettings) => void
  /** Пометить, что факт не удалось загрузить (страница покажет алерт вместо графиков) */
  setFactError: (message: string | null) => void
}

/** Собирает LinkedMortgage из ипотеки и результата mortgageToParams */
export function linkFromMortgage(m: MortgageDto, mapped: MortgageModeParams): LinkedMortgage
```

Пересчёт: `recalc(params, slipEnabled, fact)` = `calculate({...params, slipMonth: …}, fact?.engine ?? null)`.

**Гейт готовности данных:** `linkedMortgage !== null && mortgageFact === null` означает
«режим ипотеки включён, но факт ещё не загружен». В этом состоянии `result` **недостоверен**
и на экран не выводится (§8.4).

Персист: `version: 5`, `partialize` не включает `mortgageFact` и `factError`.
`migrate` при `v < 5` дозаливает поля `MortgageParams` дефолтами и обнуляет
`linkedMortgage.history`/`paidInterest` (страница перезапросит).

### 2.7. Что НЕ меняется в контрактах

`src/api/**` (типы DTO, эндпоинты), `MortgageState`, `SlipPoint`, `SlipDetails`,
`ACCOUNT_SETTING_KEYS`, `AccountSettings`, схема БД, `refundToBase`.

---

## 3. Движок: точные изменения

### 3.1. Разрешение стартового состояния

Одна приватная функция, используемая и в `calculate`, и в `simulateStrategy` — чтобы
«где берётся сумма кредита» было ровно одно место:

```ts
interface LoanStart { debt: number; ratePct: number; months: number; payment: number }

function resolveStart(p: MortgageParams, fact: FactPhase | null): LoanStart {
  if (fact) {
    return { debt: fact.debt, ratePct: fact.rate,
             months: Math.max(1, fact.remainingMonths), payment: fact.payment }
  }
  const debt = Math.max(0, p.apartmentPrice - p.downPayment)
  const months = p.termYears * 12
  return { debt, ratePct: p.itRate, months, payment: calcPMT(debt, p.itRate / 1200, months) }
}
```

Далее в `simulateStrategy`: `debt = start.debt`, `rate = start.ratePct/1200`,
`n = start.months`, `pmt = start.payment`. **Всё остальное тело цикла не трогается.**

Следствия, которые получаются бесплатно:
* исчезает округление срока до лет (D3) — `n` в месяцах;
* `minPayment` становится реальным платежом по договору (D3);
* `downPayment`/`itRate`/`termYears` перестают влиять на прогноз в режиме ипотеки (D1, D2).

### 3.2. Проценты в помесячном ряду

В `SimPoint` добавляется `interest: number` (проценты, начисленные в этом месяце; 0 для `t = 0`).
В `series[t]` — `interestPrepay` / `interestSave`. Ничего больше по строкам ряда не добавляется:
внесённый за месяц платёж восстанавливается как `interest + (debt[t−1] − debt[t])` — тождество,
следующее из самого закона движения (§11 И2).

### 3.3. Календарные налоговые годы

```
offset = fact ? fact.taxSettleOffset : 12          // гость: 12 → t = 12, 24, … как сейчас
isYearEnd(t) = salary !== null && t >= offset && (t - offset) % 12 === 0
k(t)         = (t - offset) / 12
year         = k + 1                               // гость: 1, 2, 3, … как сейчас
calendarYear = fact ? fact.currentYear + k : null
```

Начисление вычета выносится в замыкание `settleTaxYear(t)`; оно вызывается:
* внутри цикла для `t = 1…horizonMonths` при `isYearEnd(t)`;
* **один раз до записи `points[0]`**, если `offset === 0` (сегодня — декабрь): годовой возврат
  за текущий год начисляется в месяце 0.

Гость: `offset = 12`, условие `t >= 12` при `t = 0` ложно → путь `t = 0` недостижим,
поведение побайтово прежнее.

Пул незаявленных процентов на входе:

```
interestDeductiblePool = fact ? Math.max(0, fact.paidInterest - p.usedInterestBase) : 0
```

Это и есть механизм «прогнозные вычеты стартуют от остатков баз с учётом полученного»:
проценты, уплаченные до сегодня и ещё не заявленные, попадают в первый (частичный) календарный
год прогноза. Доход первого частичного года берётся **полный годовой** (`salary × 12`) —
вычет заявляется за календарный год целиком независимо от того, в каком месяце подана декларация.

### 3.4. Итоги с учётом факта

```
totalPaidWithFact     = round(sim.totalPaid     + (fact?.paidTotal    ?? 0))
totalInterestWithFact = round(sim.totalInterest + (fact?.paidInterest ?? 0))
```

### 3.5. Что в движке НЕ меняется

`slipAnalysis`, `safetyMonth`, `payoffMonth`, `slip`, `SlipDetails`, `SimOptions`, порядок
симуляций, дамп `startingSavings` в месяц 0 у `prepay`, `refundToBase`, `calcActualNDFL`,
`calcNDFLRate`. Единицы `slipMonth` — по-прежнему **месяцы от сегодня**.

---

## 4. Факт-фаза: движение денег

### 4.1. Разложение месяца

```
для s = 1 … elapsed:
    interest      = balance × rate / 1200
    scheduledPaid = min(payment, balance + interest)          // не больше полного закрытия
    principalPaid = scheduledPaid − interest                  // может быть < 0 (долг растёт)
    balance       = balance + interest − scheduledPaid

    prepayment = 0; snapshotAdjustment = 0
    для каждого события месяца (occurredOn, id):
        balance:     snapshotAdjustment += e.amount − balance;  balance = e.amount
        prepayment:  applied = min(e.amount, balance)
                     prepayment += applied;  balance −= applied
        rate:        rate = e.rate
        payment:     payment = e.amount
```

Для `s = 0`: `interest = scheduledPaid = principalPaid = 0`, события месяца выдачи применяются.
`Math.max(0, …)` больше не нужен — усечение до полного закрытия делает `min(...)`,
и это же делает закон сохранения точным.

### 4.2. Закон сохранения денег в факт-фазе

Из закона движения `debt_s = debt_{s−1} + interest_s − scheduledPaid_s − prepayment_s + snapshotAdjustment_s`,
суммируя по `s = 1…elapsed`:

```
paidScheduled + paidPrepayments = paidInterest + (principal − debtLast) + snapshotDrift
```

**Снимок рвёт баланс — и это обозначено явно:** `snapshotDrift ≠ 0` означает, что банк показал
остаток, отличный от расчётного (пропущенная корректировка, комиссии, страховка, ошибка ввода).
Это не ошибка симуляции, а измеренное расхождение. При `hasSnapshots === false` `snapshotDrift`
равен нулю тождественно, и закон превращается в чистое «платежи = проценты + тело».

UI: если `|snapshotDrift| > 1000 ₽`, в карточке «Что уже произошло» появляется строка
«Остаток по выпискам банка расходится с расчётом на X ₽ — учтено по выпискам».

### 4.3. Совместимость с существующей семантикой

`computeMortgageState` продолжает строиться поверх `buildDebtHistory` и **не меняет ни сигнатуру,
ни `MortgageState`**. Все существующие тесты `tracker.test.ts` обязаны пройти **без единой правки**
(гейт §12): новые поля точек — чистое расширение, значения `debt`/`interest`/`rate`/`payment`
вычисляются теми же формулами.

Единственное изменение накопления итогов: `paidInterest` и `interestByYear` суммируются
**в неокруглённых величинах** и округляются один раз в конце (раньше складывались уже
округлённые до копеек значения). Это уменьшает накопленную ошибку; существующие проверки
используют `toBeCloseTo`, поэтому остаются зелёными.

---

## 5. Метрики: что теперь честно

| Метрика | Было | Стало |
|---|---|---|
| «Обязательный платёж» | аннуитет от синтетического кредита с округлённым сроком | `fact.payment` — фактический платёж по договору |
| «Переплата по графику» | проценты фиктивного нового кредита | `factInterest + max(0, payment × remainingMonths − debt)` с подписью «из них уже уплачено X» |
| «Уплачено банку» | только прогноз | `totalPaidWithFact` (факт + прогноз), рядом раздельно |
| «Уплачено процентов» | только прогноз | `totalInterestWithFact`, рядом раздельно |
| «Сколько уже пройдено» | остаток из ряда истории | погашено тела, уплачено процентов, **K досрочек на Y ₽ за Z лет** |

Формулировка карточки выводов (требование владельца дословно — «в выводах видно уже уплачено
X процентов, внесено Y досрочек за Z лет»):

> **Что уже произошло**
> За 5 лет 3 мес. по этой ипотеке внесено банку **3,42 млн ₽**: из них **1,98 млн ₽** процентов
> и **1,44 млн ₽** тела. Досрочных погашений — **4** на **900 000 ₽**.
> Остаток долга **4,06 млн ₽** из исходных 5,5 млн ₽.

### 5.1. Челлендж: «переплата по графику» при слёте в прошлом

Если в прошлом было `rate`-событие (льгота уже потеряна), «график» по исходному договору больше
не существует. Рассмотрены:

| Вариант | Вердикт |
|---|---|
| `originalPayment × termMonths − principal` (исходный договор) | **Отвергнут:** после слёта это заниженная фикция — по такому графику заёмщик уже не платит |
| Пересчёт исходного графика по текущей ставке на весь срок | **Отвергнут:** выдумывает прошлое, которого не было (первые годы платились по льготной ставке) |
| **`уплачено фактически + остаток по текущему графику`** | **Принят** |

Принятый вариант единственный, который (а) не выдумывает данных, (б) корректно ведёт себя при
любом числе смен ставки, (в) для гостя тождественно сводится к прежней формуле. Подпись
метрики меняется на «Переплата по графику за весь срок», под ней — «уже уплачено X, впереди Y».

Вырожденный случай: платёж не покрывает проценты (`paymentCoversInterest === false`) — тогда
`payment × remainingMonths − debt < 0`, `max(0, …)` даёт 0, а метрика показывает только факт
с алертом «текущий платёж не покрывает проценты — переплата по графику не определена».

---

## 6. Вычеты

### 6.1. Что знает движок и что знает отчёт

Движок начисляет прогнозные вычеты по календарным годам (§3.3) и отдаёт `TaxInfo.byYear`
с меткой `calendarYear`. Проценты прошлых лет известны из факт-фазы (`interestByYear`).
Склейка — в `reporting.buildDeductionReport`.

### 6.2. Таблица вычетов по годам

| Год | Проценты за год | Что с вычетом |
|---|---|---|
| 2023 (факт) | 342 000 ₽ | заявлен (учтён в израсходованной базе) |
| 2024 (факт) | 331 000 ₽ | заявлен |
| 2025 (факт) | 318 000 ₽ | частично: базы хватило на 190 000 ₽ из 318 000 ₽ |
| 2026 (факт 8 мес. + прогноз 4 мес.) | 205 000 + 98 000 ₽ | к возврату ≈ 39 400 ₽ |
| 2027 (прогноз) | 288 000 ₽ | к возврату ≈ 37 400 ₽ |

`status` строки прошлого выводится сравнением нарастающего итога процентов с `usedInterestBase`:

```
cum(Y) = Σ interestByYear[y] для y ≤ Y
status(Y) = cum(Y) <= usedInterestBase           → 'claimed'
            cum(Y−1) < usedInterestBase < cum(Y) → 'partial'
            иначе                                 → 'forecast'  (ещё можно заявить)
claimedThroughYear = максимальный Y со status 'claimed'
```

**`claimedThroughYear` выводится, а не хранится.** Хелпер «получено по год N включительно»
в `MortgageForm` записывает в `usedInterestBase` ровно `min(3 млн, cum(N))`, поэтому обратное
преобразование точное. Если пользователь вместо хелпера ввёл сумму возврата, выведенный год —
всё равно верное утверждение («введённой базы хватает, чтобы покрыть проценты по год N»).

**Отвергнуто: хранить `claimedThroughYear` колонкой в БД.** Это потребовало бы миграции 004,
правки DTO, валидации и тестов сервера ради числа, которое однозначно выводится из уже имеющихся
данных. Хуже того — хранимое поле могло бы разойтись с `usedInterestBase` и создать второй
источник истины.

### 6.3. Первый частичный год

Проценты 2026 года = факт (январь–август) + прогноз (сентябрь–декабрь). Это ровно то, что делает
пул `interestDeductiblePool` с переносом (§3.3): незаявленные проценты факт-фазы попадают
в первый расчёт. Строка таблицы помечается `kind: 'mixed'` и подписывается «частично факт».

### 6.4. Имущественный вычет

Не меняется: база `min(2 млн, apartmentPrice) − usedPropertyBase`, ввод через `DeductionsBlock`
(сегменты «Не получал / Частично / Полностью» + сумма возврата → `refundToBase`).
`apartmentPrice` в режиме ипотеки — **реальная цена из трекера**, поэтому лимит теперь честный
(раньше цена была реальной, но соседствовала с фиктивным взносом, что путало).

---

## 7. Таймлайн, графики, горизонт

### 7.1. Ось

Без изменений относительно фазы 5: абсолютная ось «месяц от выдачи», вертикаль «Сегодня»,
переключатель «Весь срок / От сегодня», `toAbsolute` для всех `ReferenceLine`.
Меняется только источник факта: `buildTimeline(result, fact)`.

### 7.2. Новое: видимые частичные закрытия

На вкладке «Долг и накопления» досрочки прошлого рисуются `ReferenceDot` в точке
`(marker.month, debtFact[marker.month])`, цвет `CHART_COLORS.payoff`, тултип
«Досрочное погашение 300 000 ₽ · 07.2025». Смены ставки — `ReferenceLine` с пунктиром
и подписью «ставка 8%».

### 7.3. Новая вкладка «Движение денег»

`BarChart` по годам (`reporting.buildCashFlow`): три стека — «проценты», «тело», «досрочки».
Прошлые годы — насыщенные цвета, прогнозные — те же цвета с `fillOpacity 0.45`, год стыка
(`kind: 'mixed'`) подписывается «частично прогноз». Переключатель стратегии
(`SegmentedControl` «Гасить досрочно / Копить») — прогнозная часть зависит от стратегии,
фактическая одинакова.

Это и есть прямой ответ на «показывать движение денег и частичные закрытия до сегодняшнего дня».

### 7.4. Предел горизонта — челлендж

Сейчас `horizonYears = min(settings.horizonYears, termYears)`: ипотека с двумя годами до конца
срока ужимает горизонт сравнения до двух лет, и обе стратегии становятся неразличимы.

**Решение: клампа в режиме ипотеки нет.** Движок уже корректно работает за пределами срока
(`if (debt > 0 && t <= n) … else инвестируем весь бюджет`), а горизонт — это горизонт **сравнения
стратегий**, а не срок кредита: после погашения сравнивать накопления осмысленно и нужно.
Когда `horizonMonths > remainingMonths`, под графиком появляется подпись «срок ипотеки
заканчивается на N-м месяце — дальше сравниваются только накопления».

Гостевой слайдер горизонта клампится сроком **как сейчас** (`Math.min(v, params.termYears)`) —
это UI-ограничение выбора, не расчёт, и его изменение не входит в задачу.

---

## 8. Параметры в режиме ипотеки

### 8.1. Проблема

Сейчас в режиме ипотеки видны шесть слайдеров, которые двигаются и что-то меняют, хотя четыре
из них — факты по договору, а один (взнос) вообще синтетический. Пользователь может «подвигать»
цену квартиры у уже выданной ипотеки.

### 8.2. Решение: факты — карточка, личное — слайдеры

Левая колонка `ParamsSection` в режиме ипотеки заменяется на **`MortgageFactsCard`** —
read-only таблицу:

| Строка | Значение |
|---|---|
| Стоимость квартиры | 7 000 000 ₽ |
| Первоначальный взнос | 1 500 000 ₽ (21,4%) |
| Сумма кредита при выдаче | 5 500 000 ₽ |
| Дата выдачи | 01.2021 · 5 лет 7 мес. назад |
| Ставка при выдаче → сейчас | 6,0% → 8,0% *(вторая часть только если менялась)* |
| Срок по договору | 240 мес., осталось 173 мес. |
| Остаток долга | 4 062 118 ₽ |
| Обязательный платёж | 41 800 ₽/мес |

Внизу — кнопка «Изменить в трекере» → `/tracker/{id}` и ссылка «К моим параметрам»
(выход из режима). Никаких слайдеров.

Правая колонка (личное) остаётся слайдерами и полями и в режиме ипотеки, и у гостя:
**текущие накопления, бюджет в месяц, доходность вклада, горизонт сравнения, зарплата,
блок уже полученных вычетов**. Слёт — как сейчас, в `SlipSection`.

Гостевой вид `ParamsSection` **не меняется ни на пиксель** (гейт §12).

### 8.3. Ставка слёта и алерт

`SlipSection` без изменений: слайдер в месяцах от сегодня, двухуровневая подпись,
алерт «действующая ставка уже не ниже рыночной» при `params.itRate >= result.marketRateAtSlip`.
Поскольку `params.itRate` теперь тождественно равен `fact.rate`, алерт стал точным.

### 8.4. Состояние «факт ещё не загружен»

`linkedMortgage !== null && mortgageFact === null`:
* `factError === null` → `MortgageModeBanner` показывает последние известные скаляры
  с бейджем «обновляем…», а `ParamsSection`/`InsightsSection`/`ChartsSection` рендерят
  `Skeleton` вместо содержимого;
* `factError !== null` → алерт «Не удалось загрузить данные ипотеки — расчёт не показан»
  с кнопками «Повторить» и «К моим параметрам». Разделы расчёта не рендерятся.

**Почему не показать «примерный» расчёт:** именно такой компромисс и породил исходную жалобу.
Лучше пустой экран с честной причиной, чем правдоподобные неверные числа.

---

## 9. Гостевой сценарий

Изменений нет — ни в расчёте, ни в UI. Конструктивные гарантии:

1. `calculate(params)` вызывается без второго аргумента → `fact === undefined` → `resolveStart`
   идёт по прежней ветке, `offset = 12`, пул переноса `0`, `totalPaidWithFact === totalPaid`.
2. Формулы `minPayment` и `totalInterest` записаны так, что гостевая ветка — их частный случай
   без дополнительных условий (§2.1).
3. `buildTimeline(result, null)` даёт прежний результат.
4. Гейт — golden-фикстура §12.1, снятая **до** начала работ.

---

## 10. Edge-cases

| Случай | Решение |
|---|---|
| Ипотека выдана в этом месяце (`elapsed = 0`) | Факт-фаза — одна точка `[principal]`, `paidInterest = 0`, `remainingMonths = termMonths`, `payment = calcPMT(principal, rate, termMonths)`. Расчёт тождественно равен гостевому с теми же параметрами (§11 И6) |
| Ипотека выдана в будущем (`startedOn > today`) | То же самое: `elapsedMonths = 0` |
| Срок по договору истёк, долг остался | `remainingMonths = monthsToPayoff(...) ?? 1`, флаг `termExpired`; в `MortgageFactsCard` алерт «срок по договору истёк» |
| Платёж не покрывает проценты | `paymentCoversInterest = false`; история рисуется растущим долгом (это правда); метрика «переплата по графику» = только факт + алерт |
| Накопления ≥ остатка | Как в фазе 5: `payoffMonth = 0`, `debtFreeMonth = 0`, алерт, линия «Хватает на закрытие» не рисуется |
| Слёт уже случился (ставка в трекере рыночная) | Алерт в `SlipSection`, тумблер не выключаем принудительно |
| Слёт задан позже остатка срока | `effectiveSlip = 0` (условие `slipMonth < n` с `n = remainingMonths`), алерт как сейчас |
| Горизонт длиннее остатка срока | Разрешён (§7.4), подпись под графиком |
| `usedInterestBase` больше фактически уплаченных процентов | Пул переноса `max(0, …) = 0`; в таблице вычетов все прошлые годы `claimed`, строка «введено больше, чем уплачено процентов — проверьте сумму» |
| `snapshotDrift` заметный | Строка в карточке «Что уже произошло» (§4.2) |
| Сегодня — декабрь (`taxSettleOffset = 0`) | Начисление вычета за текущий год в месяце 0 (§3.3); инвариант равенства стартового капитала стратегий сохраняется |
| Ипотека закрыта (`debt = 0`) | `loanAmount = 0` → разделы расчёта скрываются, как сейчас; факт-фаза и «Что уже произошло» показываются |
| История длиннее 30 лет | Не ограничиваем |

---

## 11. Инварианты (обязательные тесты)

**И1. Сохранение денег в факт-фазе.** Для произвольного набора событий:
`paidScheduled + paidPrepayments === paidInterest + (principal − debtLast) + snapshotDrift`
с точностью 0,01 ₽. Отдельный кейс без `balance`-событий: `snapshotDrift === 0`
и равенство держится без поправки.

**И2. Тождество платежа в прогнозе.** Для всех `t ≥ 1`:
`series[t].debtSave === series[t−1].debtSave − (paid_t − series[t].interestSave)` — то есть
восстановление платежа по формуле `interest + Δdebt` корректно (допуск 2 ₽ на округления ряда).

**И3. Непрерывность долга.** `timeline.points[todayMonth].debtFact === series[0].debtSave`
и `=== round(fact.engine.debt)` и `=== round(state.currentBalance)` — все четыре числа равны.

**И4. Непрерывность капитала.**
`series[0].netWorthSave − timeline.points[todayMonth].netWorthFact === params.startingSavings`
(ступенька на «Сегодня» равна ровно введённым накоплениям, а не чему-то ещё).

**И5. Равенство стартового капитала стратегий.**
`series[0].netWorthPrepay === series[0].netWorthSave` при любом `startingSavings`,
любом `taxSettleOffset` (включая 0) и любой факт-фазе.

**И6. Эквивалентность гостю при `elapsed === 0`.** Ипотека, выданная в текущем месяце,
без событий, с `monthlyPayment === null`: `calculate(p, fact)` даёт **побайтово** тот же
результат (по проекции §12.1), что `calculate(p)` с `apartmentPrice − downPayment = principal`,
`itRate = rate`, `termYears = termMonths / 12`.

**И7. Прогноз не зависит от подменяемых вводных.** При переданной факт-фазе изменение
`params.downPayment`, `params.termYears`, `params.itRate` **не меняет** `loanAmount`,
`minPayment`, `series`, `summary`. (`apartmentPrice` менять результат вправе — лимит вычета.)

**И8. Согласованность маппинга.** `mortgageToParams(...).params.itRate === fact.engine.rate`
и `params.apartmentPrice === mortgage.propertyPrice`
и `params.downPayment === mortgage.downPayment`.

**И9. Итоги с фактом.** `summary.save.totalInterestWithFact === summary.save.totalInterest + fact.paidInterest`;
без факт-фазы обе величины равны.

**И10. Переплата по графику.** Гость: `totalInterest === round(calcPMT(L,r,n) × n − L)` (как сейчас).
Режим ипотеки: `totalInterest === round(fact.paidInterest + max(0, fact.payment × remainingMonths − fact.debt))`.

**И11. Календарные годы вычета.** При `taxSettleOffset = k`: `tax.byYear[0].calendarYear === fact.currentYear`,
`tax.byYear[i].calendarYear === fact.currentYear + i`. У гостя все `calendarYear === null`,
а `year` — прежние `1…N`.

**И12. Пул незаявленных процентов.** При `usedInterestBase >= fact.paidInterest` прогнозный
процентный вычет не больше, чем при `usedInterestBase = fact.paidInterest`; при
`usedInterestBase = 0` и `fact.paidInterest > 0` возврат первого года строго больше, чем при
`fact === null` с теми же прочими параметрами.

**И13. Отчёты.** `Σ buildCashFlow(...).total` по фактическим годам `=== fact.history.paidTotal`;
`Σ interest` по фактическим годам `=== fact.history.paidInterest` (допуск 1 ₽).

**И14. Таблица вычетов.** `claimedThroughYear` после записи хелпером
`usedInterestBase = min(3e6, cum(N))` равен `N` (round-trip).

**И15. Гостевые данные графиков.** `buildTimeline(result, null)`: `hasFact === false`,
`todayMonth === 0`, длина `points === horizonMonths + 1`, `markers === []`.

---

## 12. Гейты регрессии

### 12.1. Golden-фикстура гостя (главный гейт)

**Снимается ДО любых правок кода.** Файл `src/lib/__tests__/fixtures/guest-golden.json`
+ тест `src/lib/__tests__/guestGolden.test.ts`.

Проекция (только поля, существовавшие до фазы 6 — новые поля тест не видит и не может
сломать): `loanAmount`, `minPayment`, `totalInterest`, `marketRateAtSlip`, `safetyMonth`,
`payoffMonth`, все поля `slip`, `tax` без `calendarYear`, все восемь полей `summary.prepay`
и `summary.save` (без `*WithFact`), `advantageSave`, все девять полей каждой точки `series`,
все три поля каждой точки `slipAnalysis`.

Пять наборов параметров: базовый со слётом; без слёта с зарплатой 300к; с накоплениями 1,5 млн
и частично израсходованными базами; с бюджетом ниже обязательного платежа; с нулевым кредитом.

Регенерация фикстуры допускается **только** переменной `UPDATE_GUEST_GOLDEN=1` и **запрещена**
на протяжении всей фазы 6. Любое расхождение — блокер, а не повод обновить файл.

### 12.2. Тесты, которые запрещено править

| Файл | Правило |
|---|---|
| `src/lib/__tests__/engine.test.ts` | разделы 1–7 и 10 — **без единой правки**; допускается только дописывание новых `describe` |
| `src/lib/__tests__/tracker.test.ts` | **без единой правки** (расширение точек — чистое дополнение) |
| `src/store/__tests__/useCalculatorStore.test.ts` | кейсы тумблера слёта и правила записи в `ownParams` — без правок |

### 12.3. Тесты, которые обязаны быть переписаны

`src/lib/__tests__/mortgageToParams.test.ts` — существующие кейсы **кодируют отвергнутую модель**
(`apartmentPrice − downPayment === round(currentBalance)`, срок из проекции погашения). Они
удаляются вместе с моделью и заменяются кейсами §11 И8. Это единственное исключение из правила
«тесты не править», и оно осознанное: тест, фиксирующий отвергнутый дизайн, — не гейт, а балласт.

`src/lib/__tests__/timeline.test.ts` — меняются вызовы (новая сигнатура `buildTimeline`),
**утверждения о гостевом поведении сохраняются дословно**.

---

## 13. Сервер: почему не нужен

| Данные, которые нужны новой модели | Где уже есть |
|---|---|
| цена, взнос, исходная сумма, ставка, срок, дата выдачи, фактический платёж | `mortgages` (миграция 001) |
| события: снимки, досрочки, смены ставки и платежа | `mortgage_events` (001) |
| израсходованные базы вычетов | `mortgages.used_property_base/used_interest_base` (003) |
| стартовые накопления, зарплата, бюджет, доходность, горизонт | `user_settings` (002) |
| «получено по год N» | **выводится** из `used_interest_base` + `interestByYear` (§6.2) |

Ни одного нового поля, ни одной миграции, ни одной правки контрактов API.
Вся переработка — клиентская. `server/**` в фазе 6 **не трогается вообще**; это же и упрощает
зонирование (нет .NET-исполнителя и нет ожидания деплоя API).

---

## 14. Что отвергнуто

* **Симулировать прошлое движком по стратегиям** («а что было бы, если бы я гасил досрочно») —
  выдумывание альтернативной истории; данных о том, что заёмщик мог бы сделать, нет.
* **Хранить `claimedThroughYear` в БД** — выводится однозначно, хранение создаёт второй источник
  истины и требует миграции (§6.2).
* **Хранить накопления/капитал за прошлое** — трекер ведёт только кредит; серая линия
  «капитал без учёта накоплений» остаётся честной нижней границей (решение фазы 5 в силе).
* **Абсолютные единицы `slipMonth`** — пользователь думает «через сколько от сегодня»
  (решение фазы 5 в силе).
* **Округление срока до лет** — устранено, `remainingMonths` в месяцах.
* **Проекция погашения как остаток срока** — двойной учёт прошлых досрочек (§2.2).
* **Кламп горизонта сроком ипотеки** — уничтожал сравнение на коротких остатках (§7.4).
* **Персист факт-фазы** — стал бы вторым источником истины и мог бы разойтись с трекером;
  вместо этого явное состояние загрузки (§8.4).
* **Показывать приблизительный расчёт, пока факт не загружен** — ровно эта логика («лишь бы
  что-то показать») и породила исходную жалобу.
* **Разложение платежа прогноза отдельными полями `series`** — восстанавливается тождеством
  `interest + Δdebt`, лишние 2 × 121 числа не нужны.
