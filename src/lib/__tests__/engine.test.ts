import { describe, it, expect } from 'vitest'
import { calculate, calcPMT, refundToBase } from '../engine'
import { buildMortgageFact } from '../tracker'
import type { MortgageParams } from '../engine'
import type { MortgageDto, MortgageEventDto } from '../../api/types'

// ─── Фабрика параметров по умолчанию ───────────────────────────────────────
// loanAmount = apartmentPrice - downPayment = 7_000_000 - 1_500_000 = 5_500_000
const defaultParams = (): MortgageParams => ({
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
  startingSavings: 0,
  usedPropertyBase: 0,
  usedInterestBase: 0,
})

const noSlip = (): MortgageParams => ({ ...defaultParams(), slipMonth: 0 })

// ─── 1. Базовые расчёты ────────────────────────────────────────────────────
describe('базовые расчёты', () => {
  it('минимальный платёж корректен: 5.5M, 6%, 20 лет → ~39 404 ₽', () => {
    const result = calculate(defaultParams())
    expect(result.minPayment).toBeGreaterThan(39_000)
    expect(result.minPayment).toBeLessThan(39_900)
  })

  it('loanAmount = apartmentPrice - downPayment', () => {
    const params = defaultParams()
    const result = calculate(params)
    expect(result.loanAmount).toBe(params.apartmentPrice - params.downPayment)
  })

  it('series.length === horizonYears * 12 + 1', () => {
    const params = defaultParams()
    const result = calculate(params)
    expect(result.series.length).toBe(params.horizonYears * 12 + 1)
  })

  it('slipAnalysis.length === horizonYears * 12', () => {
    const params = defaultParams()
    const result = calculate(params)
    expect(result.slipAnalysis.length).toBe(params.horizonYears * 12)
  })

  it('marketRateAtSlip = keyRate - bankDiscount + 1.5', () => {
    const params = defaultParams()
    const result = calculate(params)
    expect(result.marketRateAtSlip).toBeCloseTo(params.keyRate - params.bankDiscount + 1.5, 5)
  })

  it('series[0]: долг = loanAmount, накоплений нет', () => {
    const result = calculate(defaultParams())
    expect(result.series[0].debtPrepay).toBeCloseTo(result.loanAmount, -1)
    expect(result.series[0].debtSave).toBeCloseTo(result.loanAmount, -1)
    expect(result.series[0].savingsSave).toBe(0)
    expect(result.series[0].savingsPrepay).toBe(0)
  })
})

// ─── 2. Стратегии: гасить досрочно vs копить ───────────────────────────────
describe('сравнение стратегий', () => {
  it('при depositRate > itRate (без слёта): копить выгоднее', () => {
    const result = calculate(noSlip())
    expect(result.summary.save.netWorth).toBeGreaterThan(result.summary.prepay.netWorth)
    expect(result.summary.advantageSave).toBeGreaterThan(0)
  })

  it('при depositRate === itRate стратегии эквивалентны (деньги фунгибельны)', () => {
    // Ключевой инвариант v2: при равных ставках гасить долг под 6% и копить
    // под 6% — одно и то же. В v1 это ломалось, т.к. после погашения долга
    // свободные деньги стратегии «гасить» никуда не шли.
    const params: MortgageParams = { ...noSlip(), depositRate: 6 }
    const result = calculate(params)
    const a = result.summary.prepay.netWorth
    const b = result.summary.save.netWorth
    expect(Math.abs(a - b)).toBeLessThan(Math.abs(a) * 0.005 + 1_000)
  })

  it('после полного погашения долга стратегия «гасить» инвестирует свободные деньги', () => {
    // freeMonthly 200к → долг гасится задолго до горизонта
    const params: MortgageParams = { ...noSlip(), freeMonthly: 200_000 }
    const result = calculate(params)
    const dfm = result.summary.prepay.debtFreeMonth
    expect(dfm).not.toBeNull()
    expect(dfm!).toBeLessThan(params.horizonYears * 12)
    // после погашения накопления растут
    const last = result.series[result.series.length - 1]
    expect(last.savingsPrepay).toBeGreaterThan(0)
    expect(last.netWorthPrepay).toBeGreaterThan(0)
  })

  it('debtPrepay[t] <= debtSave[t] для всех t (досрочка гасит быстрее)', () => {
    const result = calculate(noSlip())
    for (const point of result.series) {
      expect(point.debtPrepay).toBeLessThanOrEqual(point.debtSave + 1)
    }
  })

  it('при freeMonthly === minPayment стратегии идентичны', () => {
    const base = calculate(noSlip())
    const params: MortgageParams = { ...noSlip(), freeMonthly: base.minPayment }
    const result = calculate(params)
    const last = result.series[result.series.length - 1]
    expect(Math.abs(last.debtPrepay - last.debtSave)).toBeLessThan(last.debtSave * 0.01 + 1_000)
    expect(Math.abs(result.summary.advantageSave)).toBeLessThan(50_000)
  })
})

// ─── 3. Сценарий слёта в симуляции ────────────────────────────────────────
describe('слёт моделируется в основной симуляции', () => {
  it('в месяц слёта копящий вносит все накопления в долг', () => {
    const withSlip = calculate(defaultParams()) // slipMonth = 36
    const without = calculate(noSlip())
    const before = without.series[36]
    const after = withSlip.series[36]
    // долг после слёта = долг - накопления (базовые, до слёта серии совпадают)
    const expectedDebt = Math.max(0, before.debtSave - before.savingsSave)
    expect(after.debtSave).toBeCloseTo(expectedDebt, -2)
    // накопления обнулились (долг был больше накоплений)
    expect(after.savingsSave).toBeLessThan(1_000)
  })

  it('до слёта серии со слётом и без совпадают', () => {
    const withSlip = calculate(defaultParams())
    const without = calculate(noSlip())
    for (let t = 0; t < 36; t++) {
      expect(withSlip.series[t].debtSave).toBe(without.series[t].debtSave)
      expect(withSlip.series[t].savingsSave).toBe(without.series[t].savingsSave)
      expect(withSlip.series[t].debtPrepay).toBe(without.series[t].debtPrepay)
    }
  })

  it('после слёта платёж копящего пересчитан по рыночной ставке (≈33 890 ₽)', () => {
    const result = calculate(defaultParams())
    // ALGORITHMS.md §9.8
    expect(result.slip).not.toBeNull()
    expect(result.slip!.paymentWithPrepay).toBeGreaterThan(30_000)
    expect(result.slip!.paymentWithPrepay).toBeLessThan(37_000)
    // series отражает новый платёж
    expect(result.series[36].paymentSave).toBeCloseTo(result.slip!.paymentWithPrepay, -2)
  })

  it('платёж без внесения накоплений ≈ 75 551 ₽ (§9.7)', () => {
    const result = calculate(defaultParams())
    expect(result.slip!.paymentWithoutPrepay).toBeGreaterThan(71_000)
    expect(result.slip!.paymentWithoutPrepay).toBeLessThan(80_000)
  })

  it('slipLoss > 0: слёт ухудшает итог', () => {
    const result = calculate(defaultParams())
    expect(result.slip!.slipLoss).toBeGreaterThan(0)
  })

  it('dumpBenefit > 0 при рыночной ставке выше доходности вклада', () => {
    // market 17% > deposit 16% → внести накопления в долг выгодно
    const result = calculate(defaultParams())
    expect(result.slip!.dumpBenefit).toBeGreaterThan(0)
  })

  it('dumpBenefit < 0 при доходности вклада значительно выше рыночной ставки', () => {
    // deposit 25% >> market 17% → выгоднее НЕ гасить, а держать деньги на вкладе
    const params: MortgageParams = { ...defaultParams(), depositRate: 25 }
    const result = calculate(params)
    expect(result.slip!.dumpBenefit).toBeLessThan(0)
  })

  it('слёт также переводит стратегию «гасить досрочно» на рыночную ставку', () => {
    const withSlip = calculate(defaultParams())
    const without = calculate(noSlip())
    // при слёте досрочное погашение идёт медленнее (проценты съедают больше)
    const lastSlip = withSlip.series[withSlip.series.length - 1]
    const lastBase = without.series[without.series.length - 1]
    expect(lastSlip.netWorthPrepay).toBeLessThan(lastBase.netWorthPrepay)
  })

  it('slipMonth за пределами горизонта — считается как без слёта', () => {
    const params: MortgageParams = { ...defaultParams(), slipMonth: 999 }
    expect(() => calculate(params)).not.toThrow()
    const result = calculate(params)
    expect(result.slip).toBeNull()
    const base = calculate(noSlip())
    expect(result.summary.save.netWorth).toBe(base.summary.save.netWorth)
  })

  it('детали слёта согласованы: debtAfterPrepay = max(0, debtAtSlip - savingsAtSlip)', () => {
    const result = calculate(defaultParams())
    const s = result.slip!
    expect(s.debtAfterPrepay).toBeCloseTo(Math.max(0, s.debtAtSlip - s.savingsAtSlip), -1)
    expect(s.remainingMonths).toBe(20 * 12 - 36)
  })
})

// ─── 4. Точки: безопасность и полное погашение ─────────────────────────────
describe('точка безопасности и точка полного погашения', () => {
  it('safetyMonth: платёж-при-слёте ≤ льготному, месяцем раньше — больше', () => {
    const result = calculate(defaultParams())
    expect(result.safetyMonth).not.toBeNull()
    const m = result.safetyMonth!
    const entry = result.slipAnalysis.find((p) => p.slipMonth === m)!
    expect(entry.paymentWithPrepay).toBeLessThanOrEqual(result.minPayment + 1)
    if (m > 1) {
      const prev = result.slipAnalysis.find((p) => p.slipMonth === m - 1)!
      expect(prev.paymentWithPrepay).toBeGreaterThan(result.minPayment - 1)
    }
  })

  it('больше свободных денег → точка безопасности не позже', () => {
    const fast = calculate({ ...defaultParams(), freeMonthly: 200_000 })
    const slow = calculate(defaultParams())
    if (fast.safetyMonth !== null && slow.safetyMonth !== null) {
      expect(fast.safetyMonth).toBeLessThanOrEqual(slow.safetyMonth)
    }
  })

  it('payoffMonth: накоплений хватает закрыть долг; месяцем раньше — нет', () => {
    const result = calculate(noSlip())
    expect(result.payoffMonth).not.toBeNull()
    const m = result.payoffMonth!
    expect(result.series[m].savingsSave).toBeGreaterThanOrEqual(result.series[m].debtSave)
    expect(result.series[m - 1].savingsSave).toBeLessThan(result.series[m - 1].debtSave)
  })

  it('payoffMonth = null при слишком коротком горизонте', () => {
    const params: MortgageParams = { ...noSlip(), horizonYears: 3 }
    const result = calculate(params)
    expect(result.payoffMonth).toBeNull()
  })
})

// ─── 5. Налоговые вычеты ──────────────────────────────────────────────────
describe('налоговые вычеты', () => {
  it('salary=null → tax=null и нулевые возвраты', () => {
    const result = calculate({ ...noSlip(), salary: null })
    expect(result.tax).toBeNull()
    expect(result.summary.save.taxReturnTotal).toBe(0)
    expect(result.summary.prepay.taxReturnTotal).toBe(0)
  })

  it('salary=150 000: имущественный возврат ограничен уплаченным НДФЛ и лимитом 260 000', () => {
    // Годовой доход 1.8М (13%) < базы 2М → в первый год возврат = весь НДФЛ = 234 000,
    // остаток базы (200 000) переносится: во второй год ещё 26 000. Итого 260 000.
    const result = calculate({ ...noSlip(), salary: 150_000 })
    expect(result.tax).not.toBeNull()
    expect(result.tax!.ndflRate).toBeCloseTo(0.13, 5)
    expect(result.tax!.byYear[0].propertyReturn).toBeCloseTo(234_000, -2)
    expect(result.tax!.propertyReturnTotal).toBeCloseTo(260_000, -2)
  })

  it('возврат за год не превышает уплаченного за год НДФЛ', () => {
    const salary = 150_000
    const result = calculate({ ...noSlip(), salary })
    const ndflPerYear = salary * 12 * 0.13
    for (const row of result.tax!.byYear) {
      expect(row.amount).toBeLessThanOrEqual(ndflPerYear + 1)
    }
  })

  it('вычет по процентам ограничен базой 3 млн', () => {
    const result = calculate({ ...noSlip(), salary: 500_000 })
    // При доходе 6М/год маргинальные ставки 13–18%; возврат с базы 3М не может
    // превысить 3М × 0.18
    expect(result.tax!.interestReturnTotal).toBeLessThanOrEqual(3_000_000 * 0.18 + 1)
  })

  it('порядок вычетов: сначала имущественный, затем процентный из остатка базы', () => {
    // Доход 2.4М/год: имущественная база 2М съедает почти весь доход первого года,
    // процентному остаётся только 0.4М базы, а не полная зарплата.
    const result = calculate({ ...noSlip(), salary: 200_000 })
    const y1 = result.tax!.byYear[0]
    expect(y1.propertyReturn).toBeCloseTo(2_000_000 * 0.13, -2)
    // процентная часть за первый год ≤ 0.4М × 13%
    expect(y1.amount - y1.propertyReturn).toBeLessThanOrEqual(400_000 * 0.13 + 1)
  })

  it('вычеты симметричны: стратегия «гасить» тоже получает возвраты', () => {
    const result = calculate({ ...noSlip(), salary: 300_000 })
    expect(result.summary.prepay.taxReturnTotal).toBeGreaterThan(0)
    // у копящего проценты по кредиту выше → процентный вычет не меньше
    expect(result.summary.save.taxReturnTotal).toBeGreaterThanOrEqual(
      result.summary.prepay.taxReturnTotal - 1,
    )
  })

  it('вычеты улучшают итог обеих стратегий', () => {
    const with_ = calculate({ ...noSlip(), salary: 300_000 })
    const without = calculate({ ...noSlip(), salary: null })
    expect(with_.summary.save.netWorth).toBeGreaterThan(without.summary.save.netWorth)
    expect(with_.summary.prepay.netWorth).toBeGreaterThan(without.summary.prepay.netWorth)
  })
})

// ─── 6. Граничные случаи ──────────────────────────────────────────────────
describe('граничные случаи', () => {
  it('downPayment >= apartmentPrice: loanAmount=0, не падает', () => {
    const params: MortgageParams = { ...defaultParams(), downPayment: 7_000_000 }
    expect(() => calculate(params)).not.toThrow()
    const result = calculate(params)
    expect(result.loanAmount).toBe(0)
    expect(result.minPayment).toBe(0)
    expect(result.payoffMonth).toBeNull()
    // весь бюджет инвестируется в обеих стратегиях
    expect(result.summary.prepay.netWorth).toBe(result.summary.save.netWorth)
  })

  it('freeMonthly < minPayment: обязательный платёж всё равно вносится, накоплений нет', () => {
    const base = calculate(noSlip())
    const params: MortgageParams = { ...noSlip(), freeMonthly: Math.round(base.minPayment * 0.5) }
    const result = calculate(params)
    for (const point of result.series) {
      expect(point.savingsSave).toBe(0)
      expect(point.debtSave).toBeGreaterThanOrEqual(0)
    }
    // долг гасится по графику несмотря на нехватку бюджета
    expect(result.series[120].debtSave).toBeLessThan(result.loanAmount)
  })

  it('неотрицательность: долги и накопления >= 0 во всех сценариях', () => {
    for (const params of [defaultParams(), noSlip(), { ...defaultParams(), depositRate: 25 }]) {
      const result = calculate(params)
      for (const point of result.series) {
        expect(point.debtPrepay).toBeGreaterThanOrEqual(0)
        expect(point.debtSave).toBeGreaterThanOrEqual(0)
        expect(point.savingsPrepay).toBeGreaterThanOrEqual(0)
        expect(point.savingsSave).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('horizonYears === termYears: долг копящего к концу срока погашен', () => {
    const params: MortgageParams = { ...noSlip(), horizonYears: 20 }
    const result = calculate(params)
    const last = result.series[result.series.length - 1]
    expect(last.debtSave).toBeLessThan(1_000)
    expect(last.debtPrepay).toBe(0)
  })
})

// ─── 7. Числовые инварианты (ALGORITHMS.md §9, базовый сценарий) ──────────
describe('числовые инварианты', () => {
  it('§9.3: долг копящего на 36-м месяце ≈ 5 031 775 ₽ (±2%)', () => {
    const result = calculate(noSlip())
    expect(result.series[36].debtSave).toBeGreaterThan(4_900_000)
    expect(result.series[36].debtSave).toBeLessThan(5_150_000)
  })

  it('§9.4: накопления копящего на 36-м месяце ≈ 2 775 100 ₽ (±5%)', () => {
    const result = calculate(noSlip())
    expect(result.series[36].savingsSave).toBeGreaterThan(2_500_000)
    expect(result.series[36].savingsSave).toBeLessThan(3_100_000)
  })

  it('§9.5: долг гасящего на 36-м месяце ≈ 2 648 000 ₽', () => {
    const result = calculate(noSlip())
    expect(result.series[36].debtPrepay).toBeGreaterThan(2_000_000)
    expect(result.series[36].debtPrepay).toBeLessThan(2_700_000)
  })

  it('инвестиционный доход копящего положителен и разумен', () => {
    const result = calculate(noSlip())
    const income = result.summary.save.investmentIncome
    expect(income).toBeGreaterThan(0)
    // грубая верхняя граница: весь бюджет 10 лет под 16%
    expect(income).toBeLessThan(100_000 * 120 * 2)
  })

  it('calcPMT: 5 500 000 под 6% на 240 мес ≈ 39 404', () => {
    expect(calcPMT(5_500_000, 0.005, 240)).toBeCloseTo(39_404, -1)
  })
})

// ─── 8. Стартовые накопления (§1.6, §3.1, §9 дизайна) ──────────────────────
describe('стартовые накопления', () => {
  it('гостевой сценарий (startingSavings = 0): дампа в месяц 0 нет, стартовая позиция прежняя', () => {
    const result = calculate(noSlip())
    // Ни одна стратегия не стартует с деньгами, prepay ничего не вносит в долг в месяц 0 —
    // ровно то поведение, что было до появления startingSavings (инвариант §9.1 дизайна).
    expect(result.series[0].savingsSave).toBe(0)
    expect(result.series[0].savingsPrepay).toBe(0)
    expect(result.series[0].debtPrepay).toBe(result.loanAmount)
    expect(result.series[0].debtSave).toBe(result.loanAmount)
    expect(result.series[0].netWorthPrepay).toBe(-result.loanAmount)
    expect(result.summary.prepay.debtFreeMonth).not.toBe(0)
    expect(result.payoffMonth).not.toBe(0)
  })

  it('series[0].netWorthPrepay === series[0].netWorthSave при любых startingSavings', () => {
    const params: MortgageParams = { ...defaultParams(), startingSavings: 1_500_000 }
    const result = calculate(params)
    expect(result.series[0].netWorthPrepay).toBe(result.series[0].netWorthSave)
  })

  it('startingSavings > loanAmount → закрытие долга уже в месяц 0', () => {
    const base = calculate(noSlip())
    const params: MortgageParams = {
      ...noSlip(),
      startingSavings: base.loanAmount + 1_000_000,
    }
    const result = calculate(params)
    expect(result.summary.prepay.debtFreeMonth).toBe(0)
    expect(result.payoffMonth).toBe(0)
    expect(result.series[0].debtPrepay).toBe(0)
  })
})

// ─── 9. Использованные базы вычетов (§3.2, §9 дизайна) ─────────────────────
describe('использованные базы вычетов', () => {
  it('usedPropertyBase = 2 000 000 → имущественный вычет не начисляется', () => {
    const result = calculate({ ...noSlip(), salary: 300_000, usedPropertyBase: 2_000_000 })
    expect(result.tax!.propertyReturnTotal).toBe(0)
    expect(result.tax!.propertyBaseStart).toBe(0)
  })

  it('usedInterestBase = 3 000 000 → процентный вычет не начисляется', () => {
    const result = calculate({ ...noSlip(), salary: 300_000, usedInterestBase: 3_000_000 })
    expect(result.tax!.interestReturnTotal).toBe(0)
    expect(result.tax!.interestBaseStart).toBe(0)
  })

  it('usedPropertyBase частично (700 000) → возврат меньше полного, но больше нуля', () => {
    const full = calculate({ ...noSlip(), salary: 300_000 })
    const partial = calculate({ ...noSlip(), salary: 300_000, usedPropertyBase: 700_000 })
    expect(partial.tax!.propertyReturnTotal).toBeGreaterThan(0)
    expect(partial.tax!.propertyReturnTotal).toBeLessThan(full.tax!.propertyReturnTotal)
  })
})

// ─── 10. refundToBase (§3.4 дизайна) ────────────────────────────────────────
describe('refundToBase', () => {
  it('refundToBase(260_000, null) === 2_000_000 (13%)', () => {
    expect(refundToBase(260_000, null)).toBeCloseTo(2_000_000, 5)
  })

  it('высокая зарплата (верхняя ступень шкалы) даёт базу меньше, чем 13%', () => {
    const refund = 260_000
    const baseAt13 = refundToBase(refund, null)
    const baseAtHighSalary = refundToBase(refund, 5_000_000) // 60М/год → верхние ступени
    expect(baseAtHighSalary).toBeLessThan(baseAt13)
  })

  it('refundToBase(0, ...) === 0, отрицательные и нечисловые значения тоже дают 0', () => {
    expect(refundToBase(0, null)).toBe(0)
    expect(refundToBase(-100, null)).toBe(0)
    expect(refundToBase(NaN, null)).toBe(0)
  })
})

// ─── 11. Инварианты §11 спеки docs/specs/2026-08-14-continuous-simulation-design.md ───────
// Новый раздел (дописан целиком, §1–10 выше не изменены).
const trackerMortgage = (over: Partial<MortgageDto> = {}): MortgageDto => ({
  id: 1,
  title: 'Квартира на Ленина',
  bank: 'Сбер',
  propertyPrice: 7_000_000,
  downPayment: 1_500_000,
  principal: 5_500_000,
  rate: 6,
  termMonths: 240,
  startedOn: '2021-01-01',
  monthlyPayment: null,
  usedPropertyBase: 0,
  usedInterestBase: 0,
  createdAt: '2021-01-01T00:00:00Z',
  updatedAt: '2021-01-01T00:00:00Z',
  ...over,
})

let nextFactEventId = 1
const factEv = (partial: Partial<MortgageEventDto>): MortgageEventDto => ({
  id: nextFactEventId++,
  mortgageId: 1,
  kind: 'balance',
  occurredOn: '2021-01-01',
  amount: null,
  rate: null,
  note: null,
  createdAt: '2021-01-01T00:00:00Z',
  ...partial,
})

describe('И2: тождество платежа в прогнозе (interest + Δdebt)', () => {
  it('Σ(interest + Δdebt) по series === summary.totalPaid для обеих стратегий (без слёта, без стартовых накоплений)', () => {
    const result = calculate(noSlip())

    let sumPrepay = 0
    let sumSave = 0
    for (let t = 1; t < result.series.length; t++) {
      sumPrepay += result.series[t].interestPrepay + (result.series[t - 1].debtPrepay - result.series[t].debtPrepay)
      sumSave += result.series[t].interestSave + (result.series[t - 1].debtSave - result.series[t].debtSave)
    }

    expect(Math.abs(sumPrepay - result.summary.prepay.totalPaid)).toBeLessThan(result.series.length * 2)
    expect(Math.abs(sumSave - result.summary.save.totalPaid)).toBeLessThan(result.series.length * 2)
  })
})

describe('И5: равенство стартового капитала стратегий', () => {
  it('series[0].netWorthPrepay === series[0].netWorthSave при любом startingSavings (гость)', () => {
    const result = calculate({ ...defaultParams(), startingSavings: 900_000 })
    expect(result.series[0].netWorthPrepay).toBe(result.series[0].netWorthSave)
  })

  it('держится и с факт-фазой, включая taxSettleOffset === 0 (сегодня — декабрь)', () => {
    const m = trackerMortgage()
    const fact = buildMortgageFact(m, [], new Date('2026-12-31')) // offset === 0
    expect(fact.engine.taxSettleOffset).toBe(0)

    const p: MortgageParams = { ...defaultParams(), startingSavings: 500_000, salary: 300_000, slipMonth: 0 }
    const result = calculate(p, fact.engine)
    expect(result.series[0].netWorthPrepay).toBe(result.series[0].netWorthSave)
  })
})

describe('И6: эквивалентность гостю при elapsed === 0', () => {
  it('ипотека, выданная в текущем месяце, без событий — calculate(p, fact) === calculate(p) с эквивалентными параметрами', () => {
    const today = new Date('2026-03-01')
    const m = trackerMortgage({ startedOn: '2026-03-01', principal: 5_500_000, rate: 6, termMonths: 240 })
    const fact = buildMortgageFact(m, [], today)
    expect(fact.elapsedMonths).toBe(0)
    expect(fact.engine.paidInterest).toBe(0)
    expect(fact.engine.remainingMonths).toBe(240)

    const guestParams: MortgageParams = {
      ...defaultParams(),
      apartmentPrice: m.principal, // downPayment = 0 → loanAmount = principal
      downPayment: 0,
      itRate: m.rate,
      termYears: m.termMonths / 12,
    }
    const factParams: MortgageParams = { ...defaultParams() } // downPayment/itRate/termYears игнорируются при факте

    const guestResult = calculate(guestParams)
    const factResult = calculate(factParams, fact.engine)

    expect(factResult.loanAmount).toBe(guestResult.loanAmount)
    expect(factResult.minPayment).toBe(guestResult.minPayment)
    expect(factResult.totalInterest).toBe(guestResult.totalInterest)
    // Допуск 2 ₽: fact.engine.payment — округлённое до копеек значение (DebtHistoryPoint.payment,
    // §2.2 спеки), а не «сырой» calcPMT гостя; за 120 месяцев компаундинга это может на копейки
    // сдвинуть округлённый до рубля остаток в отдельных месяцах (та же природа допуска, что в И2).
    for (let t = 0; t < factResult.series.length; t++) {
      const f = factResult.series[t] as unknown as Record<string, number>
      const g = guestResult.series[t] as unknown as Record<string, number>
      for (const key of Object.keys(f)) {
        expect(Math.abs(f[key] - g[key])).toBeLessThanOrEqual(2)
      }
    }
    expect(Math.abs(factResult.summary.prepay.netWorth - guestResult.summary.prepay.netWorth)).toBeLessThanOrEqual(5)
    expect(Math.abs(factResult.summary.save.netWorth - guestResult.summary.save.netWorth)).toBeLessThanOrEqual(5)
  })
})

describe('И7: прогноз не зависит от подменяемых вводных при переданной факт-фазе', () => {
  it('изменение downPayment/termYears/itRate не меняет loanAmount/minPayment/series/summary', () => {
    const m = trackerMortgage()
    const fact = buildMortgageFact(m, [], new Date('2026-01-01'))

    const base = calculate({ ...defaultParams(), slipMonth: 0 }, fact.engine)
    const mutated = calculate(
      { ...defaultParams(), slipMonth: 0, downPayment: 3_000_000, termYears: 5, itRate: 25 },
      fact.engine,
    )

    expect(mutated.loanAmount).toBe(base.loanAmount)
    expect(mutated.minPayment).toBe(base.minPayment)
    expect(mutated.series).toEqual(base.series)
    expect(mutated.summary).toEqual(base.summary)
  })

  it('apartmentPrice вправе менять результат (лимит имущественного вычета)', () => {
    const m = trackerMortgage()
    const fact = buildMortgageFact(m, [], new Date('2026-01-01'))

    const base = calculate({ ...defaultParams(), slipMonth: 0, salary: 300_000, apartmentPrice: 7_000_000 }, fact.engine)
    const changed = calculate({ ...defaultParams(), slipMonth: 0, salary: 300_000, apartmentPrice: 1_500_000 }, fact.engine)

    expect(changed.tax!.propertyBaseStart).not.toBe(base.tax!.propertyBaseStart)
  })
})

describe('И9: итоги с фактом', () => {
  it('summary.save.totalInterestWithFact === summary.save.totalInterest + fact.paidInterest', () => {
    const m = trackerMortgage()
    const events = [factEv({ kind: 'prepayment', occurredOn: '2023-06-01', amount: 300_000 })]
    const fact = buildMortgageFact(m, events, new Date('2026-01-01'))

    const result = calculate({ ...defaultParams(), slipMonth: 0 }, fact.engine)
    // Допуск 1 ₽: totalInterest/totalPaid и fact.paidInterest/paidTotal каждый уже округлён
    // независимо (Math.round/round2), поэтому сумма двух округлённых величин может разойтись
    // с округлением суммы на копейку.
    expect(
      Math.abs(result.summary.save.totalInterestWithFact - (result.summary.save.totalInterest + fact.engine.paidInterest)),
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(result.summary.save.totalPaidWithFact - (result.summary.save.totalPaid + fact.engine.paidTotal)),
    ).toBeLessThanOrEqual(1)
  })

  it('без факт-фазы totalInterestWithFact === totalInterest, totalPaidWithFact === totalPaid', () => {
    const result = calculate(noSlip())
    expect(result.summary.save.totalInterestWithFact).toBe(result.summary.save.totalInterest)
    expect(result.summary.save.totalPaidWithFact).toBe(result.summary.save.totalPaid)
    expect(result.summary.prepay.totalInterestWithFact).toBe(result.summary.prepay.totalInterest)
    expect(result.summary.prepay.totalPaidWithFact).toBe(result.summary.prepay.totalPaid)
  })
})

describe('И10: переплата по графику', () => {
  it('гость: totalInterest === round(calcPMT(L,r,n) × n − L)', () => {
    const params = defaultParams()
    const result = calculate(params)
    const L = params.apartmentPrice - params.downPayment
    const r = params.itRate / 1200
    const n = params.termYears * 12
    const pmt = calcPMT(L, r, n)
    expect(result.totalInterest).toBe(Math.round(pmt * n - L))
  })

  it('режим ипотеки: totalInterest === round(fact.paidInterest + max(0, fact.payment × remainingMonths − fact.debt))', () => {
    const m = trackerMortgage()
    const fact = buildMortgageFact(m, [], new Date('2026-01-01'))
    const result = calculate({ ...defaultParams(), slipMonth: 0 }, fact.engine)

    const expected = Math.round(
      fact.engine.paidInterest + Math.max(0, fact.engine.payment * fact.engine.remainingMonths - fact.engine.debt),
    )
    expect(result.totalInterest).toBe(expected)
  })
})

describe('И11: календарные годы вычета', () => {
  it('tax.byYear[i].calendarYear === fact.currentYear + i при taxSettleOffset = k', () => {
    const m = trackerMortgage()
    const fact = buildMortgageFact(m, [], new Date('2026-08-13')) // offset = 4
    const result = calculate({ ...defaultParams(), slipMonth: 0, salary: 300_000, horizonYears: 5 }, fact.engine)

    expect(result.tax!.byYear[0].calendarYear).toBe(fact.engine.currentYear)
    for (let i = 0; i < result.tax!.byYear.length; i++) {
      expect(result.tax!.byYear[i].calendarYear).toBe(fact.engine.currentYear + i)
    }
  })

  it('у гостя все calendarYear === null, year остаётся 1…N', () => {
    const result = calculate({ ...noSlip(), salary: 300_000, horizonYears: 5 })
    expect(result.tax!.byYear.every((y) => y.calendarYear === null)).toBe(true)
    expect(result.tax!.byYear.map((y) => y.year)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('И12: пул незаявленных процентов', () => {
  it('usedInterestBase >= fact.paidInterest → прогнозный процентный вычет не больше, чем при usedInterestBase = fact.paidInterest', () => {
    const m = trackerMortgage()
    const events = [factEv({ kind: 'prepayment', occurredOn: '2023-06-01', amount: 300_000 })]
    const fact = buildMortgageFact(m, events, new Date('2026-01-01'))

    const atPaid = calculate(
      { ...defaultParams(), slipMonth: 0, salary: 300_000, usedInterestBase: fact.engine.paidInterest },
      fact.engine,
    )
    const aboveExact = calculate(
      { ...defaultParams(), slipMonth: 0, salary: 300_000, usedInterestBase: fact.engine.paidInterest + 500_000 },
      fact.engine,
    )
    expect(aboveExact.tax!.interestReturnTotal).toBeLessThanOrEqual(atPaid.tax!.interestReturnTotal)
  })

  it('usedInterestBase = 0 и fact.paidInterest > 0 → возврат первого года строго больше, чем без факта', () => {
    const m = trackerMortgage()
    const events = [factEv({ kind: 'prepayment', occurredOn: '2023-06-01', amount: 300_000 })]
    const fact = buildMortgageFact(m, events, new Date('2026-01-01'))
    expect(fact.engine.paidInterest).toBeGreaterThan(0)

    const withFact = calculate({ ...defaultParams(), slipMonth: 0, salary: 300_000, usedInterestBase: 0 }, fact.engine)
    const withoutFact = calculate({ ...defaultParams(), slipMonth: 0, salary: 300_000, usedInterestBase: 0 })

    expect(withFact.tax!.byYear[0].amount).toBeGreaterThan(withoutFact.tax!.byYear[0].amount)
  })
})
