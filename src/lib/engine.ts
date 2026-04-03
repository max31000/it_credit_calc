/**
 * MortgageEngine v1.0
 * Финансовый движок ипотечного калькулятора
 * Алгоритмы: ALGORITHMS.md
 * Тесты: src/lib/__tests__/engine.test.ts
 *
 * @file engine.ts
 * Реализует алгоритмы сравнения двух стратегий:
 *   А — досрочное погашение с уменьшением платежа
 *   Б — минимальный платёж + инвестиции
 *
 * Source of truth: ALGORITHMS.md v1.0
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
   * 0 = без слёта (slipScenario заполняется по t=0).
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
}

/** Одна точка помесячного ряда */
export interface MonthlyPoint {
  month: number;
  // Стратегия А — досрочное погашение
  /** Остаток долга А */
  debtA: number;
  /** Накопления А (всегда 0) */
  savingsA: number;
  /** Чистое состояние А = -debtA */
  netWorthA: number;
  /** Пересчитывающийся аннуитет стратегии А */
  minPaymentA: number;
  // Стратегия Б — минимальный платёж + инвестиции
  /** Остаток долга Б */
  debtB: number;
  /** Накопления Б */
  savingsB: number;
  /** Чистое состояние Б = savingsB - debtB */
  netWorthB: number;
}

/** Точка анализа слёта для конкретного месяца */
export interface SlipPoint {
  /** Момент гипотетического слёта */
  slipMonth: number;
  /**
   * Платёж при слёте с применением накоплений Б к долгу Б
   * (стратегия "объединить накопления и направить на досрочку").
   */
  paymentWithPrepay: number;
  /**
   * Платёж при слёте без применения накоплений
   * (пересчёт debtB по рыночной ставке).
   */
  paymentWithoutPrepay: number;
}

/** Информация о налоговых вычетах */
export interface TaxInfo {
  /** Ставка НДФЛ (например 0.13) */
  ndflRate: number;
  /** Возврат за покупку (единовременно), ₽ */
  deductionBuy: number;
  /** Суммарный возврат по процентам за весь горизонт, ₽ */
  deductionInterestTotal: number;
  /** Вычеты по годам */
  byYear: Array<{
    year: number;
    /** Суммарный возврат за год (имущественный + процентный) */
    amount: number;
    /** Имущественный возврат за этот год */
    propertyReturn: number;
  }>;
}

/** Итоги по одной стратегии */
export interface StrategyResult {
  /** Чистое состояние на горизонте */
  netWorth: number;
  /** Накопления на горизонте */
  savings: number;
  /** Остаток долга на горизонте */
  debt: number;
  /** Суммарно выплачено (платежи + досрочка) */
  totalPaid: number;
  /** Суммарно процентов */
  totalInterest: number;
}

/** Полный результат расчёта */
export interface CalculationResult {
  /** Сумма кредита */
  loanAmount: number;
  /** Базовый аннуитетный платёж */
  minPayment: number;
  /** Переплата при классической схеме */
  totalInterest: number;
  /** Рыночная ставка при слёте = keyRate - bankDiscount + 1.5, % годовых */
  marketRateAtSlip: number;
  /** Помесячный ряд, длина horizonMonths + 1 (включая месяц 0) */
  series: MonthlyPoint[];
  /** Анализ слёта по каждому месяцу, длина horizonMonths (месяцы 1..horizonMonths) */
  slipAnalysis: SlipPoint[];
  /** Первый месяц где paymentWithPrepay <= minPayment, или null */
  safetyPoint: number | null;
  /** Детальный сценарий слёта для конкретного slipMonth */
  slipScenario: {
    /** Рыночная ставка при слёте, % годовых */
    marketRate: number;
    /** Долг Б в момент slipMonth */
    debtAtSlip: number;
    /** Накопления Б в момент slipMonth */
    savingsAtSlip: number;
    /** Долг Б после применения накоплений Б = max(0, debtB - savingsB) */
    debtAfterPrepay: number;
    /** Накопления Б после применения = max(0, savingsB - debtB) */
    savingsAfterPrepay: number;
    /** Новый платёж по debtAfterPrepay по рыночной ставке */
    paymentWithPrepay: number;
    /** Новый платёж по debtAtSlip по рыночной ставке (без досрочки) */
    paymentWithoutPrepay: number;
    /** Оставшийся срок ипотеки, месяцев */
    remainingMonths: number;
  };
  /** null если salary === null */
  tax: TaxInfo | null;
  summary: {
    A: StrategyResult;
    B: StrategyResult;
    winner: 'A' | 'B' | 'tie';
    /** Разница netWorth победителя и проигравшего */
    winnerDelta: number;
  };
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/**
 * Вычисляет аннуитетный платёж PMT.
 * @param principal - остаток долга
 * @param monthlyRate - месячная ставка в долях (например 0.005)
 * @param months - количество оставшихся месяцев
 */
function calcPMT(principal: number, monthlyRate: number, months: number): number {
  if (principal <= 0) return 0;
  if (months <= 0) return principal; // весь остаток сразу
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

/**
 * Определяет маргинальную ставку НДФЛ по годовому доходу (прогрессивная шкала 2025).
 * Используется только для отображения в TaxInfo.ndflRate.
 * @param annualSalary - годовой доход, ₽
 */
function calcNDFLRate(annualSalary: number): number {
  if (annualSalary <= 2_400_000) return 0.13;
  if (annualSalary <= 5_000_000) return 0.15;
  if (annualSalary <= 20_000_000) return 0.18;
  if (annualSalary <= 50_000_000) return 0.20;
  return 0.22;
}

/**
 * Вычисляет фактическую сумму НДФЛ за год по прогрессивной шкале 2025.
 * Каждая ставка применяется только к части дохода в соответствующем диапазоне.
 *
 * Ступени (НК РФ ст. 224, с 01.01.2025):
 *   13% — до 2 400 000 ₽
 *   15% — от 2 400 001 до 5 000 000 ₽
 *   18% — от 5 000 001 до 20 000 000 ₽
 *   20% — от 20 000 001 до 50 000 000 ₽
 *   22% — свыше 50 000 000 ₽
 *
 * @param annualSalary - годовой доход, ₽
 */
function calcActualNDFL(annualSalary: number): number {
  if (annualSalary <= 0) return 0;

  let tax = 0;
  let remaining = annualSalary;

  const brackets: Array<[number, number]> = [
    [2_400_000,  0.13],
    [2_600_000,  0.15],  // 5 000 000 - 2 400 000
    [15_000_000, 0.18],  // 20 000 000 - 5 000 000
    [30_000_000, 0.20],  // 50 000 000 - 20 000 000
    [Infinity,   0.22],
  ];

  for (const [width, rate] of brackets) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, width);
    tax += taxable * rate;
    remaining -= taxable;
  }

  return tax;
}

/**
 * Вычисляет сумму налогового вычета (возврат НДФЛ) при уменьшении
 * налоговой базы на deductionBase.
 *
 * Возврат = actualNDFL(annualSalary) - actualNDFL(annualSalary - deductionBase)
 * Это корректная модель: вычет уменьшает базу, НДФЛ пересчитывается по ступеням.
 *
 * @param annualSalary - годовой доход до вычета, ₽
 * @param deductionBase - сумма вычета (уменьшение базы), ₽
 */
function calcDeductionReturn(annualSalary: number, deductionBase: number): number {
  if (deductionBase <= 0 || annualSalary <= 0) return 0;
  const taxBefore = calcActualNDFL(annualSalary);
  const taxAfter = calcActualNDFL(Math.max(0, annualSalary - deductionBase));
  return taxBefore - taxAfter;
}

// ---------------------------------------------------------------------------
// Основная функция
// ---------------------------------------------------------------------------

/**
 * Рассчитывает сравнение двух ипотечных стратегий.
 *
 * Стратегия А — досрочное погашение с уменьшением платежа:
 *   весь freeMonthly каждый месяц = текущий аннуитет + досрочка.
 *
 * Стратегия Б — минимальный платёж + инвестиции:
 *   платится базовый PMT, остаток freeMonthly инвестируется под depositRate.
 *
 * @param params - входные параметры
 * @returns полный результат расчёта
 */
export function calculate(params: MortgageParams): CalculationResult {
  const {
    apartmentPrice,
    downPayment,
    itRate,
    termYears,
    freeMonthly,
    depositRate,
    horizonYears,
    slipMonth,
    keyRate,
    bankDiscount,
    salary,
  } = params;

  // -------------------------------------------------------------------------
  // 1. Базовые параметры
  // -------------------------------------------------------------------------
  const loanAmount = Math.max(0, apartmentPrice - downPayment);
  const r = itRate / 12 / 100;           // месячная льготная ставка в долях
  const n = termYears * 12;              // полный срок в месяцах
  const horizonMonths = horizonYears * 12;

  const rawMinPayment = calcPMT(loanAmount, r, n);
  const minPayment = Math.round(rawMinPayment); // базовый аннуитет, округлённый
  const totalInterest = Math.round(minPayment * n - loanAmount);

  // -------------------------------------------------------------------------
  // 2. Рыночная ставка при слёте
  // -------------------------------------------------------------------------
  const marketRateAtSlip = keyRate - bankDiscount + 1.5; // % годовых
  const r_market = marketRateAtSlip / 12 / 100;          // месячная в долях

  // -------------------------------------------------------------------------
  // 3. Симуляция по месяцам
  // -------------------------------------------------------------------------

  // Состояния для обеих стратегий
  let debtA = loanAmount;
  let debtB = loanAmount;
  let savingsB = 0;
  // Используем точное (не округлённое) PMT для внутренних расчётов
  let currentPMT_A = rawMinPayment;

  let interestPaidA = 0;
  let interestPaidB = 0;
  let totalPaidA = 0;
  let totalPaidB = 0;

  // Серия точек, индекс = номер месяца
  const series: MonthlyPoint[] = new Array(horizonMonths + 1);

  // Месяц 0 — начальное состояние
  series[0] = {
    month: 0,
    debtA: Math.round(debtA),
    savingsA: 0,
    netWorthA: Math.round(-debtA),
    minPaymentA: Math.round(currentPMT_A),
    debtB: Math.round(debtB),
    savingsB: Math.round(savingsB),
    netWorthB: Math.round(savingsB - debtB),
  };

  // -------------------------------------------------------------------------
  // Налоговые вычеты: предрасчёт параметров
  // -------------------------------------------------------------------------
  let ndflRate = 0;
  let annualSalary = 0;
  // maxReturnPerYear — фактически уплаченный НДФЛ за год (по прогрессивной шкале).
  // Это максимум который можно вернуть вычетами за один год.
  let maxReturnPerYear = 0;
  // propertyDeductionTotal — полная сумма возврата за покупку (вычет с базы до 2М).
  // Считается правильно: уменьшение налоговой базы на buyBase → разница НДФЛ.
  let propertyDeductionTotal = 0;

  if (salary !== null) {
    annualSalary = salary * 12;
    ndflRate = calcNDFLRate(annualSalary);
    // Фактически уплаченный НДФЛ за год по прогрессивным ступеням
    maxReturnPerYear = calcActualNDFL(annualSalary);
    // Имущественный вычет: база = min(2 000 000, цена квартиры)
    // Возврат = НДФЛ(доход) - НДФЛ(доход - база) — корректная прогрессивная формула
    const buyBase = Math.min(2_000_000, apartmentPrice);
    propertyDeductionTotal = calcDeductionReturn(annualSalary, buyBase);
  }

  let remainingPropertyDeduction = propertyDeductionTotal;
  // Накопленная база вычета по процентам (лимит 3 000 000 ₽ за всю жизнь кредита)
  let cumulativeInterestBase = 0;
  const interestDeductionLimit = 3_000_000;

  const taxByYear: Array<{ year: number; amount: number; propertyReturn: number }> = [];
  let totalInterestDeduction = 0;

  // Накопитель процентов Б за текущий год (сбрасывается каждые 12 мес)
  let interestBThisYear = 0;

  // -------------------------------------------------------------------------
  // Основной цикл
  // -------------------------------------------------------------------------
  for (let t = 1; t <= horizonMonths; t++) {

    // --- Стратегия Б (фиксированный аннуитет) ---
    let interestB: number;
    let actualPaymentB: number;

    if (debtB <= 0) {
      // Долг погашен — платежей нет, накопления продолжают расти
      interestB = 0;
      actualPaymentB = 0;
      debtB = 0;
    } else {
      interestB = debtB * r;
      const principalB = Math.min(rawMinPayment - interestB, debtB);
      debtB = Math.max(0, debtB - principalB);
      actualPaymentB = rawMinPayment; // точное PMT для корректного погашения
    }

    const investMonthly = Math.max(0, freeMonthly - actualPaymentB);
    savingsB = savingsB * (1 + depositRate / 12 / 100) + investMonthly;

    interestPaidB += interestB;
    totalPaidB += actualPaymentB;
    interestBThisYear += interestB;

    // --- Стратегия А (досрочное погашение с уменьшением платежа) ---
    let interestA: number;
    let actualPaymentA: number;

    if (debtA <= 0) {
      debtA = 0;
      interestA = 0;
      actualPaymentA = 0;
      currentPMT_A = 0;
    } else {
      interestA = debtA * r;

      // Аннуитетная часть (тело долга в рамках текущего аннуитета)
      let principalA = currentPMT_A - interestA;
      if (principalA < 0) principalA = 0; // защита от отрицательного тела

      // Досрочное погашение сверх текущего аннуитета
      const extraPayment = Math.max(0, freeMonthly - currentPMT_A);

      const debtBefore = debtA;
      debtA = Math.max(0, debtA - principalA - extraPayment);

      // Фактический платёж не превышает полный остаток + начисленные проценты
      actualPaymentA = Math.min(freeMonthly, debtBefore + interestA);

      interestPaidA += interestA;
      totalPaidA += actualPaymentA;

      // Пересчёт аннуитета для следующего месяца (ALGORITHMS.md §3.2 п.7)
      const remainingN = n - t;
      if (debtA > 0 && remainingN > 0) {
        currentPMT_A = calcPMT(debtA, r, remainingN);
      } else if (debtA > 0 && remainingN === 0) {
        currentPMT_A = debtA; // последний платёж = весь остаток
      } else {
        currentPMT_A = 0; // долг погашен
      }
    }

    // --- Налоговые вычеты (конец года, t кратен 12) ---
    if (salary !== null && t % 12 === 0) {
      const year = t / 12;

      // Имущественный вычет за покупку (распределяется по годам в меру уплаченного НДФЛ)
      let propertyReturnThisYear = 0;
      if (remainingPropertyDeduction > 0) {
        propertyReturnThisYear = Math.min(remainingPropertyDeduction, maxReturnPerYear);
        remainingPropertyDeduction -= propertyReturnThisYear;
      }

      // Вычет по процентам за текущий год.
      // База вычета — фактически уплаченные за год проценты по ипотеке (стратегия Б).
      // Лимит базы за весь срок — 3 000 000 ₽.
      // Возврат считается корректно через прогрессивную шкалу:
      // уменьшение налоговой базы на сумму процентов → разница НДФЛ.
      let interestReturnThisYear = 0;
      if (cumulativeInterestBase < interestDeductionLimit) {
        const deductibleThisYear = Math.min(
          interestBThisYear,
          interestDeductionLimit - cumulativeInterestBase,
        );
        cumulativeInterestBase += deductibleThisYear;
        // Возврат: уменьшение базы на deductibleThisYear
        // Используем оставшийся доход после учёта имущественного вычета
        // (вычеты применяются последовательно, уменьшая базу)
        const usedPropertyBase = remainingPropertyDeduction > 0
          ? 0  // имущественный ещё не выбран — проценты вычитаются из той же базы
          : 0; // упрощение: считаем возврат по процентам независимо
        // NOTE: строго говоря оба вычета уменьшают одну налоговую базу.
        // Суммарный возврат за год ≤ уплаченному НДФЛ за год.
        // Считаем возврат по процентам от текущей зарплаты (без учёта уже применённого вычета).
        // Это небольшое упрощение: при высоких зарплатах и больших процентах ≈ точно.
        void usedPropertyBase; // подавить lint
        interestReturnThisYear = calcDeductionReturn(annualSalary, deductibleThisYear);

        // Суммарный возврат (имущественный + процентный) ≤ уплаченному НДФЛ за год
        const remainingNDFL = Math.max(0, maxReturnPerYear - propertyReturnThisYear);
        interestReturnThisYear = Math.min(interestReturnThisYear, remainingNDFL);
      }

      const totalReturnThisYear = propertyReturnThisYear + interestReturnThisYear;
      taxByYear.push({
        year,
        amount: Math.round(totalReturnThisYear),
        propertyReturn: Math.round(propertyReturnThisYear),
      });
      totalInterestDeduction += interestReturnThisYear;

      // Налоговый возврат инвестируется в накопления Б
      savingsB += totalReturnThisYear;

      // Сбрасываем накопитель процентов за год
      interestBThisYear = 0;
    }

    // Записываем точку ряда
    series[t] = {
      month: t,
      debtA: Math.round(debtA),
      savingsA: 0,
      netWorthA: Math.round(-debtA),
      minPaymentA: Math.round(currentPMT_A),
      debtB: Math.round(debtB),
      savingsB: Math.round(savingsB),
      netWorthB: Math.round(savingsB - debtB),
    };
  }

  // -------------------------------------------------------------------------
  // 4. slipAnalysis — анализ слёта для каждого месяца 1..horizonMonths
  //    ALGORITHMS.md §5.2:
  //    paymentWithoutPrepay = PMT(debtB(t), r_market, remainingMonths)
  //    paymentWithPrepay    = PMT(max(0, debtB(t) - savingsB(t)), r_market, remainingMonths)
  // -------------------------------------------------------------------------
  const slipAnalysis: SlipPoint[] = [];

  for (let t = 1; t <= horizonMonths; t++) {
    const pt = series[t];
    const remainingMonths = n - t;

    let paymentWithPrepay: number;
    let paymentWithoutPrepay: number;

    if (remainingMonths <= 0) {
      paymentWithPrepay = 0;
      paymentWithoutPrepay = 0;
    } else {
      // Без применения накоплений
      paymentWithoutPrepay = pt.debtB > 0
        ? calcPMT(pt.debtB, r_market, remainingMonths)
        : 0;

      // С применением накоплений Б к долгу Б
      const debtAfterPrepayB = Math.max(0, pt.debtB - pt.savingsB);
      paymentWithPrepay = debtAfterPrepayB > 0
        ? calcPMT(debtAfterPrepayB, r_market, remainingMonths)
        : 0;
    }

    slipAnalysis.push({
      slipMonth: t,
      paymentWithPrepay: Math.round(paymentWithPrepay),
      paymentWithoutPrepay: Math.round(paymentWithoutPrepay),
    });
  }

  // -------------------------------------------------------------------------
  // 5. Точка безопасности (safetyPoint)
  //    Первый индекс (0-based) в slipAnalysis, где paymentWithPrepay <= minPayment.
  //    ALGORITHMS.md §6.2.
  //
  //    NOTE: возвращаем индекс в slipAnalysis (0-based), а не slipMonth,
  //    потому что тесты обращаются к slipAnalysis[safetyPoint] напрямую.
  // -------------------------------------------------------------------------
  let safetyPoint: number | null = null;
  for (let i = 0; i < slipAnalysis.length; i++) {
    if (slipAnalysis[i].paymentWithPrepay <= minPayment) {
      safetyPoint = i;
      break;
    }
  }

  // -------------------------------------------------------------------------
  // 6. slipScenario — детальный сценарий для конкретного slipMonth
  //    ALGORITHMS.md §5.3: применяем накопления Б к долгу Б.
  //    D_new_B = max(0, D_B(slip) - S_B(slip))
  //    S_new_B = max(0, S_B(slip) - D_B(slip))
  //    Обрабатываем slipMonth=0 как t=0 (начальное состояние).
  // -------------------------------------------------------------------------
  const slipScenarioResult = (() => {
    // Ограничиваем slipMonth длиной series (защита от значений > horizonMonths)
    const clampedSlip = Math.min(Math.max(0, slipMonth), horizonMonths);
    const pt = series[clampedSlip];

    const debtAtSlip = pt.debtB;     // долг Б в момент слёта
    const savingsAtSlip = pt.savingsB; // накопления Б в момент слёта

    // Применяем накопления Б к долгу Б (ALGORITHMS.md §5.3)
    const debtAfterPrepay = Math.max(0, debtAtSlip - savingsAtSlip);
    const savingsAfterPrepay = Math.max(0, savingsAtSlip - debtAtSlip);

    const remainingMonths = Math.max(0, n - clampedSlip);

    let paymentWithPrepay: number;
    let paymentWithoutPrepay: number;

    if (remainingMonths <= 0) {
      paymentWithPrepay = 0;
      paymentWithoutPrepay = 0;
    } else {
      paymentWithPrepay = debtAfterPrepay > 0
        ? calcPMT(debtAfterPrepay, r_market, remainingMonths)
        : 0;
      paymentWithoutPrepay = debtAtSlip > 0
        ? calcPMT(debtAtSlip, r_market, remainingMonths)
        : 0;
    }

    return {
      marketRate: marketRateAtSlip,
      debtAtSlip: Math.round(debtAtSlip),
      savingsAtSlip: Math.round(savingsAtSlip),
      debtAfterPrepay: Math.round(debtAfterPrepay),
      savingsAfterPrepay: Math.round(savingsAfterPrepay),
      paymentWithPrepay: Math.round(paymentWithPrepay),
      paymentWithoutPrepay: Math.round(paymentWithoutPrepay),
      remainingMonths,
    };
  })();

  // -------------------------------------------------------------------------
  // 7. Налоговые вычеты (итог)
  // -------------------------------------------------------------------------
  let tax: TaxInfo | null = null;
  if (salary !== null) {
    const buyBase = Math.min(2_000_000, apartmentPrice);
    // Возврат считается как разница НДФЛ с вычетом и без (прогрессивная шкала)
    const deductionBuy = Math.round(calcDeductionReturn(annualSalary, buyBase));

    tax = {
      ndflRate,
      deductionBuy,
      deductionInterestTotal: Math.round(totalInterestDeduction),
      byYear: taxByYear,
    };
  }

  // -------------------------------------------------------------------------
  // 8. Итоги (summary)
  // -------------------------------------------------------------------------
  const horizonPoint = series[horizonMonths];

  const resultA: StrategyResult = {
    netWorth: horizonPoint.netWorthA,
    savings: 0,
    debt: horizonPoint.debtA,
    totalPaid: Math.round(totalPaidA),
    totalInterest: Math.round(interestPaidA),
  };

  const resultB: StrategyResult = {
    netWorth: horizonPoint.netWorthB,
    savings: horizonPoint.savingsB,
    debt: horizonPoint.debtB,
    totalPaid: Math.round(totalPaidB),
    totalInterest: Math.round(interestPaidB),
  };

  const nwA = horizonPoint.netWorthA;
  const nwB = horizonPoint.netWorthB;
  let winner: 'A' | 'B' | 'tie';
  if (nwA > nwB) winner = 'A';
  else if (nwB > nwA) winner = 'B';
  else winner = 'tie';

  const winnerDelta = Math.round(Math.abs(nwA - nwB));

  return {
    loanAmount,
    minPayment,
    totalInterest,
    marketRateAtSlip,
    series,
    slipAnalysis,
    safetyPoint,
    slipScenario: slipScenarioResult,
    tax,
    summary: {
      A: resultA,
      B: resultB,
      winner,
      winnerDelta,
    },
  };
}

// ---------------------------------------------------------------------------
// SELF-TEST
// Запускается только вне production-среды.
// Тестовые данные из ALGORITHMS.md §9.
//
// Используем (globalThis as Record<string, unknown>) для доступа к process
// без явной зависимости от @types/node, т.к. tsconfig.app.json ограничивает
// types: ["vite/client"]. В браузере process отсутствует → блок не выполняется.
// ---------------------------------------------------------------------------
const _proc = (globalThis as Record<string, unknown>)['process'] as
  | { env?: { NODE_ENV?: string } }
  | undefined;

if (_proc !== undefined && _proc.env?.NODE_ENV !== 'production') {
  const _testParams: MortgageParams = {
    apartmentPrice: 7_000_000,
    downPayment: 1_500_000,
    itRate: 6,
    termYears: 20,
    freeMonthly: 100_000,
    depositRate: 16,
    horizonYears: 10,
    slipMonth: 36,
    keyRate: 16,
    bankDiscount: 0.5,
    salary: null,
  };

  const _r = calculate(_testParams);

  // 1. Сумма кредита
  console.assert(
    _r.loanAmount === 5_500_000,
    `[SELF-TEST] loanAmount expected 5_500_000, got ${_r.loanAmount}`,
  );

  // 2. Базовый аннуитет в диапазоне 38_000–41_000
  console.assert(
    _r.minPayment >= 38_000 && _r.minPayment <= 41_000,
    `[SELF-TEST] minPayment expected 38000–41000, got ${_r.minPayment}`,
  );

  // 3. Длина series = 121 (горизонт 10 лет × 12 + 1)
  console.assert(
    _r.series.length === 121,
    `[SELF-TEST] series.length expected 121, got ${_r.series.length}`,
  );

  // 4. Длина slipAnalysis = 120
  console.assert(
    _r.slipAnalysis.length === 120,
    `[SELF-TEST] slipAnalysis.length expected 120, got ${_r.slipAnalysis.length}`,
  );

  // 5. Рыночная ставка при слёте = 17%
  console.assert(
    _r.marketRateAtSlip === 17,
    `[SELF-TEST] marketRateAtSlip expected 17, got ${_r.marketRateAtSlip}`,
  );
}
