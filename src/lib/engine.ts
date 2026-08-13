/**
 * MortgageEngine v2.0
 * Финансовый движок ипотечного калькулятора.
 * Алгоритмы: ALGORITHMS.md, дизайн: docs/specs/2026-08-12-calculator-v2-design.md
 * Тесты: src/lib/__tests__/engine.test.ts
 *
 * Сравнивает два подхода к льготной ипотеке:
 *   prepay — «гасить досрочно»: весь бюджет уходит в платёж + досрочку
 *            с уменьшением ежемесячного платежа;
 *   save   — «копить»: платится минимальный аннуитет, остаток бюджета
 *            инвестируется под рыночную доходность.
 *
 * Слёт с льготной программы моделируется внутри симуляции: в месяц слёта
 * ставка становится рыночной, а стратегия save (по умолчанию) немедленно
 * вносит все накопления в досрочное погашение.
 *
 * Внешние зависимости: отсутствуют.
 */

// ---------------------------------------------------------------------------
// Интерфейсы
// ---------------------------------------------------------------------------

/** Входные параметры ипотечного калькулятора */
export interface MortgageParams {
  /** Стоимость квартиры, ₽ */
  apartmentPrice: number;
  /** Первоначальный взнос, ₽ */
  downPayment: number;
  /** Льготная ставка, % годовых (например 6) */
  itRate: number;
  /** Срок кредита, лет */
  termYears: number;
  /**
   * Свободные деньги в месяц, ₽.
   * Суммарный бюджет на ипотечные цели (минимальный платёж + досрочка / инвестиции).
   */
  freeMonthly: number;
  /** Доходность вклада/облигаций, % годовых */
  depositRate: number;
  /** Горизонт сравнения, лет */
  horizonYears: number;
  /**
   * Месяц слёта с льготной ипотеки (1-индексация).
   * 0 = слёта нет.
   */
  slipMonth: number;
  /** Ключевая ставка ЦБ на момент слёта, % годовых */
  keyRate: number;
  /** Дисконт банка к ключевой ставке, % (обычно 0.5) */
  bankDiscount: number;
  /**
   * Зарплата до налогов, ₽/мес.
   * null — налоговые вычеты не рассчитываются.
   */
  salary: number | null;
  /**
   * Текущие накопления сверх кредита на «сегодня», ₽. Стратегия «копить» стартует с них,
   * «гасить досрочно» вносит их в долг в месяц 0 (см. §1.6 дизайна).
   */
  startingSavings: number;
  /** Уже израсходованная база имущественного вычета, ₽ (0…2 000 000) */
  usedPropertyBase: number;
  /** Уже израсходованная база вычета по ипотечным процентам, ₽ (0…3 000 000) */
  usedInterestBase: number;
}

/**
 * Фактическое состояние ипотеки на «сегодня» — вход прогноза.
 * Строится трекером (`buildMortgageFact`), движок его только читает и не знает про даты.
 * null — гостевой сценарий: кредит берётся сейчас, прошлого нет.
 */
export interface FactPhase {
  /** Остаток долга на «сегодня», ₽ — стартовая точка прогноза */
  debt: number;
  /** Действующая ставка на «сегодня», % годовых */
  rate: number;
  /** Действующий обязательный платёж на «сегодня», ₽ */
  payment: number;
  /** Остаток срока на «сегодня», месяцев; всегда ≥ 1 */
  remainingMonths: number;
  /** Уплачено процентов с выдачи до «сегодня», ₽ */
  paidInterest: number;
  /** Внесено банку с выдачи до «сегодня» (обязательные платежи + досрочки), ₽ */
  paidTotal: number;
  /** Месяцев от «сегодня» до конца текущего календарного года, 0…11 */
  taxSettleOffset: number;
  /** Календарный год «сегодня» — метка для TaxInfo.byYear[].calendarYear */
  currentYear: number;
}

/** Одна точка помесячного ряда (отображаемый сценарий) */
export interface MonthlyPoint {
  month: number;
  /** Остаток долга: гасить досрочно */
  debtPrepay: number;
  /** Накопления: гасить досрочно (появляются после погашения долга) */
  savingsPrepay: number;
  /** Чистое состояние: гасить досрочно */
  netWorthPrepay: number;
  /** Текущий обязательный платёж: гасить досрочно */
  paymentPrepay: number;
  /** Остаток долга: копить */
  debtSave: number;
  /** Накопления: копить */
  savingsSave: number;
  /** Чистое состояние: копить */
  netWorthSave: number;
  /** Текущий обязательный платёж: копить */
  paymentSave: number;
  /** Проценты, начисленные в этом месяце, стратегия «гасить досрочно», ₽ */
  interestPrepay: number;
  /** Проценты, начисленные в этом месяце, стратегия «копить», ₽ */
  interestSave: number;
}

/** Точка анализа слёта: что будет с платежом, если слёт случится в этот месяц */
export interface SlipPoint {
  /** Момент гипотетического слёта */
  slipMonth: number;
  /** Платёж после слёта, если внести все накопления в долг */
  paymentWithPrepay: number;
  /** Платёж после слёта без внесения накоплений */
  paymentWithoutPrepay: number;
}

/** Информация о налоговых вычетах (по стратегии «копить», отображаемый сценарий) */
export interface TaxInfo {
  /** Маргинальная ставка НДФЛ (например 0.13) — для отображения */
  ndflRate: number;
  /** Суммарный возврат по имущественному вычету за горизонт, ₽ */
  propertyReturnTotal: number;
  /** Суммарный возврат по процентному вычету за горизонт, ₽ */
  interestReturnTotal: number;
  /** Вычеты по годам */
  byYear: Array<{
    /** Порядковый год прогноза, 1…N (как раньше) */
    year: number;
    /** Суммарный возврат за год */
    amount: number;
    /** Имущественная часть возврата */
    propertyReturn: number;
    /** Календарный год; null — гостевой сценарий (календаря нет) */
    calendarYear: number | null;
  }>;
  /** База имущественного вычета, доступная на «сегодня» (после вычитания использованной), ₽ */
  propertyBaseStart: number;
  /** База вычета по процентам, доступная на «сегодня», ₽ */
  interestBaseStart: number;
  /** Остаток базы имущественного вычета на конец горизонта, ₽ */
  propertyBaseLeft: number;
  /** Остаток базы вычета по процентам на конец горизонта, ₽ */
  interestBaseLeft: number;
}

/** Итоги по одной стратегии на горизонте */
export interface StrategyResult {
  /** Чистое состояние = накопления − долг */
  netWorth: number;
  /** Накопления */
  savings: number;
  /** Остаток долга */
  debt: number;
  /** Суммарно выплачено банку (платежи + досрочка) */
  totalPaid: number;
  /** Суммарно уплачено процентов */
  totalInterest: number;
  /** Суммарный возврат НДФЛ */
  taxReturnTotal: number;
  /** Проценты, заработанные на накоплениях */
  investmentIncome: number;
  /** Месяц полного погашения долга (null — не погашен в горизонте) */
  debtFreeMonth: number | null;
  /** Уплачено банку с выдачи ипотеки: факт + прогноз, ₽ (без факт-фазы === totalPaid) */
  totalPaidWithFact: number;
  /** Уплачено процентов с выдачи ипотеки: факт + прогноз, ₽ (без факт-фазы === totalInterest) */
  totalInterestWithFact: number;
}

/** Детали сценария слёта (только при slipMonth > 0) */
export interface SlipDetails {
  /** Рыночная ставка после слёта, % годовых */
  marketRate: number;
  /** Долг стратегии «копить» в момент слёта */
  debtAtSlip: number;
  /** Накопления стратегии «копить» в момент слёта */
  savingsAtSlip: number;
  /** Долг после внесения накоплений */
  debtAfterPrepay: number;
  /** Накопления после внесения */
  savingsAfterPrepay: number;
  /** Новый платёж, если внести накопления в долг */
  paymentWithPrepay: number;
  /** Новый платёж без внесения накоплений */
  paymentWithoutPrepay: number;
  /** Оставшийся срок ипотеки на момент слёта, месяцев */
  remainingMonths: number;
  /**
   * Цена слёта: насколько хуже станет чистое состояние на горизонте
   * по сравнению со сценарием без слёта (стратегия «копить», с внесением накоплений).
   */
  slipLoss: number;
  /**
   * Экономия от внесения накоплений при слёте: разница чистого состояния
   * на горизонте между «внести всё в долг» и «ничего не делать».
   */
  dumpBenefit: number;
}

/** Полный результат расчёта */
export interface CalculationResult {
  /** Сумма кредита */
  loanAmount: number;
  /** Базовый льготный аннуитет */
  minPayment: number;
  /** Переплата при выплате по графику (без досрочки и слёта) */
  totalInterest: number;
  /** Рыночная ставка при слёте = keyRate − bankDiscount + 1.5, % годовых */
  marketRateAtSlip: number;
  /**
   * Помесячный ряд отображаемого сценария (со слётом, если slipMonth > 0),
   * длина horizonMonths + 1 (включая месяц 0).
   */
  series: MonthlyPoint[];
  /** Анализ платежа при слёте для каждого месяца 1..horizonMonths (без слёта в базе) */
  slipAnalysis: SlipPoint[];
  /**
   * Точка безопасности: первый месяц, начиная с которого даже при слёте
   * (с внесением накоплений) платёж не превысит льготный. null — не достигнута.
   */
  safetyMonth: number | null;
  /**
   * Первый месяц, когда накоплений стратегии «копить» (без слёта) хватает,
   * чтобы закрыть долг целиком. null — не достигается в горизонте.
   */
  payoffMonth: number | null;
  /** Детали слёта (null при slipMonth = 0) */
  slip: SlipDetails | null;
  /** Налоговые вычеты стратегии «копить» (null если salary = null) */
  tax: TaxInfo | null;
  summary: {
    /** Гасить досрочно (отображаемый сценарий) */
    prepay: StrategyResult;
    /** Копить (отображаемый сценарий) */
    save: StrategyResult;
    /** Преимущество «копить» над «гасить досрочно» по netWorth (может быть < 0) */
    advantageSave: number;
  };
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/**
 * Аннуитетный платёж PMT.
 * @param principal - остаток долга
 * @param monthlyRate - месячная ставка в долях (например 0.005)
 * @param months - количество оставшихся месяцев
 */
export function calcPMT(principal: number, monthlyRate: number, months: number): number {
  if (principal <= 0) return 0;
  if (months <= 0) return principal; // весь остаток сразу
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/**
 * Маргинальная ставка НДФЛ по годовому доходу (прогрессивная шкала с 2025).
 * Используется только для отображения.
 */
function calcNDFLRate(annualSalary: number): number {
  if (annualSalary <= 2_400_000) return 0.13;
  if (annualSalary <= 5_000_000) return 0.15;
  if (annualSalary <= 20_000_000) return 0.18;
  if (annualSalary <= 50_000_000) return 0.2;
  return 0.22;
}

/**
 * «Сколько уже вернули НДФЛ» → «сколько базы израсходовано» (§1.5, §3.4 дизайна).
 * base = refund / маргинальная ставка НДФЛ по годовому доходу; при salary === null — 13%.
 * Допущение: вычет уменьшает доход сверху вниз по прогрессивной шкале, поэтому пересчёт
 * идёт по маргинальной, а не средней ставке — для дохода до 2.4М ₽/год это ровно 13%.
 */
export function refundToBase(refund: number, salary: number | null): number {
  if (!Number.isFinite(refund) || refund <= 0) return 0;
  const rate = salary !== null ? calcNDFLRate(salary * 12) : 0.13;
  return refund / rate;
}

/**
 * Фактическая сумма НДФЛ за год по прогрессивной шкале 2025 (НК РФ ст. 224):
 * 13% до 2.4М, 15% до 5М, 18% до 20М, 20% до 50М, 22% свыше.
 */
function calcActualNDFL(annualIncome: number): number {
  if (annualIncome <= 0) return 0;

  const brackets: Array<[number, number]> = [
    [2_400_000, 0.13],
    [2_600_000, 0.15], // 5М − 2.4М
    [15_000_000, 0.18], // 20М − 5М
    [30_000_000, 0.2], // 50М − 20М
    [Infinity, 0.22],
  ];

  let tax = 0;
  let remaining = annualIncome;
  for (const [width, rate] of brackets) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, width);
    tax += taxable * rate;
    remaining -= taxable;
  }
  return tax;
}

// ---------------------------------------------------------------------------
// Симулятор одной стратегии
// ---------------------------------------------------------------------------

/** Лимит базы имущественного вычета, ₽ */
const PROPERTY_DEDUCTION_BASE_LIMIT = 2_000_000;
/** Лимит базы вычета по ипотечным процентам за всю жизнь кредита, ₽ */
const INTEREST_DEDUCTION_BASE_LIMIT = 3_000_000;

interface SimOptions {
  /** prepay — гасить досрочно; save — минимальный платёж + инвестиции */
  strategy: 'prepay' | 'save';
  /** Месяц слёта (0 = нет). Слёт применяется в конце месяца slipMonth. */
  slipMonth: number;
  /** Вносить ли накопления в долг в момент слёта */
  dumpSavingsAtSlip: boolean;
}

interface SimPoint {
  month: number;
  debt: number;
  savings: number;
  /** Обязательный платёж следующего месяца */
  payment: number;
  /** Проценты, начисленные в этом месяце (0 для t = 0) */
  interest: number;
}

/** Стартовое состояние прогноза — единственное место, где берётся сумма кредита, ставка,
 *  срок и стартовый платёж (§3.1 спеки docs/specs/2026-08-14-continuous-simulation-design.md). */
interface LoanStart {
  debt: number;
  ratePct: number;
  months: number;
  payment: number;
}

/**
 * `fact` — фактическое состояние ипотеки на «сегодня» (из трекера). null — гостевой
 * сценарий: кредит берётся сейчас по вводным параметрам.
 */
function resolveStart(p: MortgageParams, fact: FactPhase | null): LoanStart {
  if (fact) {
    return {
      debt: fact.debt,
      ratePct: fact.rate,
      months: Math.max(1, fact.remainingMonths),
      payment: fact.payment,
    };
  }
  const debt = Math.max(0, p.apartmentPrice - p.downPayment);
  const months = p.termYears * 12;
  return { debt, ratePct: p.itRate, months, payment: calcPMT(debt, p.itRate / 1200, months) };
}

interface SimResult {
  /** Точки 0..horizonMonths (нескруглённые значения) */
  points: SimPoint[];
  totalPaid: number;
  totalInterest: number;
  taxReturnTotal: number;
  propertyReturnTotal: number;
  interestReturnTotal: number;
  taxByYear: Array<{ year: number; amount: number; propertyReturn: number; calendarYear: number | null }>;
  investmentIncome: number;
  debtFreeMonth: number | null;
  /** База имущественного вычета, доступная на «сегодня» (до расходования в симуляции), ₽ */
  propertyBaseStart: number;
  /** База вычета по процентам, доступная на «сегодня», ₽ */
  interestBaseStart: number;
  /** Остаток базы имущественного вычета после симуляции, ₽ */
  propertyBaseLeft: number;
  /** Остаток базы вычета по процентам после симуляции, ₽ */
  interestBaseLeft: number;
}

/**
 * Прогоняет одну стратегию по месяцам 1..horizonMonths.
 *
 * Правила:
 * - До слёта действует льготная ставка; в конце месяца slipMonth ставка
 *   становится рыночной и аннуитет пересчитывается на остаток срока.
 * - Стратегия save при слёте (если dumpSavingsAtSlip) сначала вносит
 *   все накопления в долг.
 * - Обязательный платёж вносится всегда, даже если freeMonthly меньше него.
 * - После полного погашения долга весь freeMonthly инвестируется.
 * - Налоговые вычеты (при salary != null) начисляются в конце каждого года:
 *   база года = 12×зарплата, сначала расходуется имущественная база
 *   (до 2 млн), затем процентная (фактические проценты, суммарно до 3 млн);
 *   возврат = разница НДФЛ по прогрессивной шкале. Неиспользованные базы
 *   переносятся на следующие годы. Возврат у save идёт в накопления,
 *   у prepay — в досрочное погашение (после погашения долга — в накопления).
 */
function simulateStrategy(params: MortgageParams, opts: SimOptions, fact: FactPhase | null): SimResult {
  const {
    apartmentPrice,
    freeMonthly,
    depositRate,
    horizonYears,
    keyRate,
    bankDiscount,
    salary,
    startingSavings,
    usedPropertyBase,
    usedInterestBase,
  } = params;
  const { strategy, slipMonth, dumpSavingsAtSlip } = opts;

  const start = resolveStart(params, fact);
  const n = start.months;
  const horizonMonths = horizonYears * 12;
  const rMarket = (keyRate - bankDiscount + 1.5) / 12 / 100;
  const rDeposit = depositRate / 12 / 100;

  let debt = start.debt;
  let savings = startingSavings;
  let rate = start.ratePct / 1200;
  // Обязательный аннуитет. Для save фиксируется до слёта; для prepay пересчитывается ежемесячно.
  let pmt = start.payment;

  const offset = fact ? fact.taxSettleOffset : 12;

  let totalPaid = 0;
  let totalInterest = 0;
  let investmentIncome = 0;
  let debtFreeMonth: number | null = null;

  // Налоговые базы (переносятся между годами), уменьшенные на уже израсходованную часть (§3.2 дизайна)
  const annualIncome = salary !== null ? salary * 12 : 0;
  let propertyBaseRemaining = salary !== null ? Math.max(0, Math.min(PROPERTY_DEDUCTION_BASE_LIMIT, apartmentPrice) - usedPropertyBase) : 0;
  let interestBaseRemaining = Math.max(0, INTEREST_DEDUCTION_BASE_LIMIT - usedInterestBase);
  const propertyBaseStart = propertyBaseRemaining;
  const interestBaseStart = interestBaseRemaining;
  /** Уплаченные проценты, ещё не заявленные к вычету (перенос между годами). При переданном
   *  факте — незаявленные проценты факт-фазы переносятся в пул первого года прогноза (§3.3). */
  let interestDeductiblePool = fact ? Math.max(0, fact.paidInterest - usedInterestBase) : 0;

  let taxReturnTotal = 0;
  let propertyReturnTotal = 0;
  let interestReturnTotal = 0;
  const taxByYear: Array<{ year: number; amount: number; propertyReturn: number; calendarYear: number | null }> = [];

  const points: SimPoint[] = new Array(horizonMonths + 1);

  /** Досрочное внесение суммы в долг с пересчётом аннуитета (в конце месяца t) */
  const prepayIntoDebt = (amount: number, t: number): number => {
    const applied = Math.min(amount, debt);
    debt -= applied;
    totalPaid += applied;
    if (debt <= 0.005) {
      debt = 0;
      if (debtFreeMonth === null) debtFreeMonth = t;
      pmt = 0;
    } else if (strategy === 'save') {
      // save пересчитывает аннуитет только на событиях (слёт/вычет-в-досрочку не бывает)
      pmt = calcPMT(debt, rate, Math.max(1, n - t));
    }
    return applied;
  };

  /**
   * Начисление налогового вычета за календарный год, заканчивающийся в месяце `t`
   * (`k` — порядковый номер года прогноза от нуля). Вынесено в замыкание (§3.3 спеки), потому
   * что вызывается и внутри цикла на границе года, и один раз до записи points[0], если
   * «сегодня» — конец календарного года (`offset === 0`).
   */
  const settleTaxYear = (t: number, k: number): void => {
    // Имущественная база расходуется первой, процентная — из остатка дохода
    const propUse = Math.min(propertyBaseRemaining, annualIncome);
    const intUse = Math.min(interestDeductiblePool, interestBaseRemaining, Math.max(0, annualIncome - propUse));

    const taxFull = calcActualNDFL(annualIncome);
    const taxAfterProperty = calcActualNDFL(annualIncome - propUse);
    const taxAfterBoth = calcActualNDFL(annualIncome - propUse - intUse);

    const propertyReturn = taxFull - taxAfterProperty;
    const interestReturn = taxAfterProperty - taxAfterBoth;
    const totalReturn = propertyReturn + interestReturn;

    propertyBaseRemaining -= propUse;
    interestBaseRemaining -= intUse;
    interestDeductiblePool -= intUse;

    propertyReturnTotal += propertyReturn;
    interestReturnTotal += interestReturn;
    taxReturnTotal += totalReturn;
    taxByYear.push({
      year: k + 1,
      amount: Math.round(totalReturn),
      propertyReturn: Math.round(propertyReturn),
      calendarYear: fact ? fact.currentYear + k : null,
    });

    // Возврат: save — в накопления, prepay — в досрочку (или в накопления, если долга нет)
    if (totalReturn > 0) {
      if (strategy === 'prepay' && debt > 0) {
        const applied = prepayIntoDebt(totalReturn, t);
        pmt = debt > 0 ? calcPMT(debt, rate, Math.max(1, n - t)) : 0;
        savings += totalReturn - applied;
      } else {
        savings += totalReturn;
      }
    }
  };

  // Дамп стартовых накоплений в долг для prepay ДО записи points[0] (§1.6, §3.1 дизайна):
  // политика «всё свободное — в долг» распространяется и на уже имеющиеся деньги, иначе
  // стартовый капитал netWorth(0) = savings − debt разошёлся бы между стратегиями.
  if (strategy === 'prepay' && savings > 0 && debt > 0) {
    const applied = Math.min(savings, debt);
    debt -= applied;
    savings -= applied;
    totalPaid += applied;
    if (debt <= 0.005) {
      debt = 0;
      debtFreeMonth = 0;
      pmt = 0;
    } else {
      pmt = calcPMT(debt, rate, n);
    }
  }
  if (debtFreeMonth === null && debt <= 0) debtFreeMonth = 0;

  // Начисление вычета за текущий (уже истёкший) календарный год до старта прогноза —
  // только когда «сегодня» приходится на конец календарного года (offset === 0).
  if (salary !== null && offset === 0) {
    settleTaxYear(0, 0);
  }

  points[0] = { month: 0, debt, savings, payment: pmt, interest: 0 };

  for (let t = 1; t <= horizonMonths; t++) {
    // --- Ежемесячный платёж ---
    let monthInterest = 0;
    if (debt > 0 && t <= n) {
      const interest = debt * rate;
      monthInterest = interest;
      totalInterest += interest;
      interestDeductiblePool += interest;

      // Обязательный платёж (не больше полного закрытия долга)
      const mandatory = Math.min(pmt, debt + interest);

      let payment: number;
      if (strategy === 'prepay') {
        // Весь бюджет в платёж; не меньше обязательного, не больше полного закрытия
        payment = Math.min(Math.max(mandatory, freeMonthly), debt + interest);
      } else {
        payment = mandatory;
      }

      debt = Math.max(0, debt - (payment - interest));
      totalPaid += payment;

      if (debt <= 0.005) {
        debt = 0;
        if (debtFreeMonth === null) debtFreeMonth = t;
        pmt = 0;
      } else if (strategy === 'prepay') {
        // Досрочка с уменьшением платежа: аннуитет пересчитывается каждый месяц
        pmt = calcPMT(debt, rate, Math.max(1, n - t));
      }

      // Остаток бюджета инвестируется (для prepay остаётся только после закрытия долга)
      const invest = Math.max(0, freeMonthly - payment);
      const earned = savings * rDeposit;
      investmentIncome += earned;
      savings += earned + invest;
    } else {
      // Долг погашен (или срок вышел) — инвестируем весь бюджет
      const earned = savings * rDeposit;
      investmentIncome += earned;
      savings += earned + freeMonthly;
    }

    // --- Слёт (в конце месяца slipMonth) ---
    if (slipMonth > 0 && t === slipMonth && debt > 0 && t < n) {
      rate = rMarket;
      if (strategy === 'save' && dumpSavingsAtSlip && savings > 0) {
        const applied = prepayIntoDebt(savings, t);
        savings -= applied;
      }
      if (debt > 0) {
        pmt = calcPMT(debt, rate, n - t);
      }
    }

    // --- Налоговые вычеты (конец календарного года, §3.3 спеки) ---
    if (salary !== null && t >= offset && (t - offset) % 12 === 0) {
      settleTaxYear(t, (t - offset) / 12);
    }

    points[t] = { month: t, debt, savings, payment: pmt, interest: monthInterest };
  }

  return {
    points,
    totalPaid,
    totalInterest,
    taxReturnTotal,
    propertyReturnTotal,
    interestReturnTotal,
    taxByYear,
    investmentIncome,
    debtFreeMonth,
    propertyBaseStart,
    interestBaseStart,
    propertyBaseLeft: propertyBaseRemaining,
    interestBaseLeft: interestBaseRemaining,
  };
}

// ---------------------------------------------------------------------------
// Основная функция
// ---------------------------------------------------------------------------

/** Итоги стратегии из результата симуляции; `fact` — для итогов «с учётом факта» (§3.4 спеки) */
function toStrategyResult(sim: SimResult, fact: FactPhase | null): StrategyResult {
  const last = sim.points[sim.points.length - 1];
  return {
    netWorth: Math.round(last.savings - last.debt),
    savings: Math.round(last.savings),
    debt: Math.round(last.debt),
    totalPaid: Math.round(sim.totalPaid),
    totalInterest: Math.round(sim.totalInterest),
    taxReturnTotal: Math.round(sim.taxReturnTotal),
    investmentIncome: Math.round(sim.investmentIncome),
    debtFreeMonth: sim.debtFreeMonth,
    totalPaidWithFact: Math.round(sim.totalPaid + (fact?.paidTotal ?? 0)),
    totalInterestWithFact: Math.round(sim.totalInterest + (fact?.paidInterest ?? 0)),
  };
}

/**
 * Рассчитывает сравнение подходов «гасить досрочно» и «копить»
 * с учётом сценария слёта с льготной программы.
 *
 * `fact === null | undefined` — гостевой сценарий: кредит берётся сейчас, поведение побайтово
 * прежнее. `fact !== null` — прогноз продолжает фактическую ипотеку: сумма кредита, ставка,
 * платёж и остаток срока берутся из `fact`, а `downPayment`, `itRate`, `termYears` движком
 * не используются (§11 И7 спеки).
 */
export function calculate(params: MortgageParams, fact?: FactPhase | null): CalculationResult {
  const { horizonYears, keyRate, bankDiscount, salary } = params;
  const factPhase: FactPhase | null = fact ?? null;

  // Единственное место, где берётся сумма кредита, ставка, срок и стартовый платёж (§3.1 спеки).
  const start = resolveStart(params, factPhase);
  const loanAmount = start.debt;
  const n = start.months;
  const horizonMonths = horizonYears * 12;

  const minPayment = Math.round(start.payment);
  // Одно выражение на оба режима: для гостя factInterest = 0 и max(0, …) — тождественный no-op.
  const factInterest = factPhase ? factPhase.paidInterest : 0;
  const totalInterest = Math.round(factInterest + Math.max(0, start.payment * start.months - start.debt));

  const marketRateAtSlip = keyRate - bankDiscount + 1.5;
  const rMarket = marketRateAtSlip / 12 / 100;

  // Слёт после конца срока или за горизонтом смысла не имеет
  const effectiveSlip = params.slipMonth > 0 && params.slipMonth < n ? Math.min(params.slipMonth, horizonMonths) : 0;

  // -------------------------------------------------------------------------
  // Симуляции: базовые всегда, слётные — при slipMonth > 0
  // -------------------------------------------------------------------------
  const basePrepay = simulateStrategy(params, { strategy: 'prepay', slipMonth: 0, dumpSavingsAtSlip: false }, factPhase);
  const baseSave = simulateStrategy(params, { strategy: 'save', slipMonth: 0, dumpSavingsAtSlip: false }, factPhase);

  const hasSlip = effectiveSlip > 0;
  const slipPrepay = hasSlip
    ? simulateStrategy(params, { strategy: 'prepay', slipMonth: effectiveSlip, dumpSavingsAtSlip: false }, factPhase)
    : basePrepay;
  const slipSaveDump = hasSlip
    ? simulateStrategy(params, { strategy: 'save', slipMonth: effectiveSlip, dumpSavingsAtSlip: true }, factPhase)
    : baseSave;
  const slipSaveNoDump = hasSlip
    ? simulateStrategy(params, { strategy: 'save', slipMonth: effectiveSlip, dumpSavingsAtSlip: false }, factPhase)
    : baseSave;

  // Отображаемый сценарий: со слётом, если он задан
  const shownPrepay = slipPrepay;
  const shownSave = slipSaveDump;

  // -------------------------------------------------------------------------
  // Помесячный ряд отображаемого сценария
  // -------------------------------------------------------------------------
  const series: MonthlyPoint[] = new Array(horizonMonths + 1);
  for (let t = 0; t <= horizonMonths; t++) {
    const p = shownPrepay.points[t];
    const s = shownSave.points[t];
    series[t] = {
      month: t,
      debtPrepay: Math.round(p.debt),
      savingsPrepay: Math.round(p.savings),
      netWorthPrepay: Math.round(p.savings - p.debt),
      paymentPrepay: Math.round(p.payment),
      debtSave: Math.round(s.debt),
      savingsSave: Math.round(s.savings),
      netWorthSave: Math.round(s.savings - s.debt),
      paymentSave: Math.round(s.payment),
      interestPrepay: Math.round(p.interest),
      interestSave: Math.round(s.interest),
    };
  }

  // -------------------------------------------------------------------------
  // Анализ слёта по месяцам (база — сценарий «копить» без слёта):
  // если слёт случится в месяц t, каким станет платёж
  // -------------------------------------------------------------------------
  const slipAnalysis: SlipPoint[] = [];
  for (let t = 1; t <= horizonMonths; t++) {
    const pt = baseSave.points[t];
    const remainingMonths = n - t;

    let paymentWithPrepay = 0;
    let paymentWithoutPrepay = 0;
    if (remainingMonths > 0 && pt.debt > 0) {
      paymentWithoutPrepay = calcPMT(pt.debt, rMarket, remainingMonths);
      const debtAfter = Math.max(0, pt.debt - pt.savings);
      paymentWithPrepay = debtAfter > 0 ? calcPMT(debtAfter, rMarket, remainingMonths) : 0;
    }

    slipAnalysis.push({
      slipMonth: t,
      paymentWithPrepay: Math.round(paymentWithPrepay),
      paymentWithoutPrepay: Math.round(paymentWithoutPrepay),
    });
  }

  // Точка безопасности: первый месяц, где платёж-после-слёта ≤ льготному
  let safetyMonth: number | null = null;
  for (const pt of slipAnalysis) {
    if (pt.paymentWithPrepay <= minPayment) {
      safetyMonth = pt.slipMonth;
      break;
    }
  }

  // Точка полного погашения: накоплений хватает, чтобы закрыть долг.
  // Старт с t=0 (§3.3 дизайна): накоплений может хватать уже сегодня.
  let payoffMonth: number | null = null;
  if (loanAmount > 0) {
    for (let t = 0; t <= horizonMonths; t++) {
      const pt = baseSave.points[t];
      if (pt.savings >= pt.debt) {
        payoffMonth = t;
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Детали слёта
  // -------------------------------------------------------------------------
  let slip: SlipDetails | null = null;
  if (hasSlip) {
    const at = baseSave.points[effectiveSlip];
    const debtAfterPrepay = Math.max(0, at.debt - at.savings);
    const savingsAfterPrepay = Math.max(0, at.savings - at.debt);
    const remainingMonths = Math.max(0, n - effectiveSlip);

    const netWorthAt = (sim: SimResult) => {
      const last = sim.points[sim.points.length - 1];
      return last.savings - last.debt;
    };

    slip = {
      marketRate: marketRateAtSlip,
      debtAtSlip: Math.round(at.debt),
      savingsAtSlip: Math.round(at.savings),
      debtAfterPrepay: Math.round(debtAfterPrepay),
      savingsAfterPrepay: Math.round(savingsAfterPrepay),
      paymentWithPrepay: Math.round(debtAfterPrepay > 0 && remainingMonths > 0 ? calcPMT(debtAfterPrepay, rMarket, remainingMonths) : 0),
      paymentWithoutPrepay: Math.round(at.debt > 0 && remainingMonths > 0 ? calcPMT(at.debt, rMarket, remainingMonths) : 0),
      remainingMonths,
      slipLoss: Math.round(netWorthAt(baseSave) - netWorthAt(slipSaveDump)),
      dumpBenefit: Math.round(netWorthAt(slipSaveDump) - netWorthAt(slipSaveNoDump)),
    };
  }

  // -------------------------------------------------------------------------
  // Налоговые вычеты (отображаемый сценарий «копить»)
  // -------------------------------------------------------------------------
  let tax: TaxInfo | null = null;
  if (salary !== null) {
    tax = {
      ndflRate: calcNDFLRate(salary * 12),
      propertyReturnTotal: Math.round(shownSave.propertyReturnTotal),
      interestReturnTotal: Math.round(shownSave.interestReturnTotal),
      byYear: shownSave.taxByYear,
      propertyBaseStart: Math.round(shownSave.propertyBaseStart),
      interestBaseStart: Math.round(shownSave.interestBaseStart),
      propertyBaseLeft: Math.round(shownSave.propertyBaseLeft),
      interestBaseLeft: Math.round(shownSave.interestBaseLeft),
    };
  }

  // -------------------------------------------------------------------------
  // Итоги
  // -------------------------------------------------------------------------
  const prepayResult = toStrategyResult(shownPrepay, factPhase);
  const saveResult = toStrategyResult(shownSave, factPhase);

  return {
    loanAmount,
    minPayment,
    totalInterest,
    marketRateAtSlip,
    series,
    slipAnalysis,
    safetyMonth,
    payoffMonth,
    slip,
    tax,
    summary: {
      prepay: prepayResult,
      save: saveResult,
      advantageSave: saveResult.netWorth - prepayResult.netWorth,
    },
  };
}
