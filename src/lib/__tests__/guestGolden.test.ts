/// <reference types="node" />
/**
 * Golden-фикстура гостевого сценария — главный гейт фазы 6 (§12.1 спеки
 * docs/specs/2026-08-14-continuous-simulation-design.md).
 *
 * Снята ДО любых правок кода на исходной (ещё не изменённой) реализации `calculate`.
 * `projectGuest` перечисляет ЯВНЫМ списком только поля, существовавшие до фазы 6 —
 * никаких `Object.keys`/spread, чтобы новые поля движка (totalPaidWithFact,
 * interestPrepay/interestSave, calendarYear и т.п.) тест не мог увидеть и не мог сломать
 * фикстуру просто фактом своего появления.
 *
 * Регенерация — ТОЛЬКО `UPDATE_GUEST_GOLDEN=1 npx vitest run src/lib/__tests__/guestGolden.test.ts`.
 * Запрещена на протяжении всей фазы 6 (см. план). Красный golden — блокер, а не повод
 * перегенерировать файл.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculate } from '../engine'
import type { MortgageParams, CalculationResult } from '../engine'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'guest-golden.json')

/**
 * Проекция результата на поля, существовавшие ДО фазы 6. Явный список — намеренно,
 * это единственный способ гарантировать, что тест не увидит новых полей движка.
 */
function projectGuest(result: CalculationResult) {
  return {
    loanAmount: result.loanAmount,
    minPayment: result.minPayment,
    totalInterest: result.totalInterest,
    marketRateAtSlip: result.marketRateAtSlip,
    safetyMonth: result.safetyMonth,
    payoffMonth: result.payoffMonth,
    slip:
      result.slip === null
        ? null
        : {
            marketRate: result.slip.marketRate,
            debtAtSlip: result.slip.debtAtSlip,
            savingsAtSlip: result.slip.savingsAtSlip,
            debtAfterPrepay: result.slip.debtAfterPrepay,
            savingsAfterPrepay: result.slip.savingsAfterPrepay,
            paymentWithPrepay: result.slip.paymentWithPrepay,
            paymentWithoutPrepay: result.slip.paymentWithoutPrepay,
            remainingMonths: result.slip.remainingMonths,
            slipLoss: result.slip.slipLoss,
            dumpBenefit: result.slip.dumpBenefit,
          },
    tax:
      result.tax === null
        ? null
        : {
            ndflRate: result.tax.ndflRate,
            propertyReturnTotal: result.tax.propertyReturnTotal,
            interestReturnTotal: result.tax.interestReturnTotal,
            byYear: result.tax.byYear.map((y) => ({
              year: y.year,
              amount: y.amount,
              propertyReturn: y.propertyReturn,
            })),
            propertyBaseStart: result.tax.propertyBaseStart,
            interestBaseStart: result.tax.interestBaseStart,
            propertyBaseLeft: result.tax.propertyBaseLeft,
            interestBaseLeft: result.tax.interestBaseLeft,
          },
    summary: {
      prepay: {
        netWorth: result.summary.prepay.netWorth,
        savings: result.summary.prepay.savings,
        debt: result.summary.prepay.debt,
        totalPaid: result.summary.prepay.totalPaid,
        totalInterest: result.summary.prepay.totalInterest,
        taxReturnTotal: result.summary.prepay.taxReturnTotal,
        investmentIncome: result.summary.prepay.investmentIncome,
        debtFreeMonth: result.summary.prepay.debtFreeMonth,
      },
      save: {
        netWorth: result.summary.save.netWorth,
        savings: result.summary.save.savings,
        debt: result.summary.save.debt,
        totalPaid: result.summary.save.totalPaid,
        totalInterest: result.summary.save.totalInterest,
        taxReturnTotal: result.summary.save.taxReturnTotal,
        investmentIncome: result.summary.save.investmentIncome,
        debtFreeMonth: result.summary.save.debtFreeMonth,
      },
      advantageSave: result.summary.advantageSave,
    },
    series: result.series.map((p) => ({
      month: p.month,
      debtPrepay: p.debtPrepay,
      savingsPrepay: p.savingsPrepay,
      netWorthPrepay: p.netWorthPrepay,
      paymentPrepay: p.paymentPrepay,
      debtSave: p.debtSave,
      savingsSave: p.savingsSave,
      netWorthSave: p.netWorthSave,
      paymentSave: p.paymentSave,
    })),
    slipAnalysis: result.slipAnalysis.map((p) => ({
      slipMonth: p.slipMonth,
      paymentWithPrepay: p.paymentWithPrepay,
      paymentWithoutPrepay: p.paymentWithoutPrepay,
    })),
  }
}

const base = (): MortgageParams => ({
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

/** Пять наборов параметров §12.1 спеки */
const cases: Record<string, MortgageParams> = {
  baseWithSlip: base(),
  noSlipWithSalary: { ...base(), slipMonth: 0, salary: 300_000 },
  savingsAndPartialBases: {
    ...base(),
    slipMonth: 0,
    salary: 250_000,
    startingSavings: 1_500_000,
    usedPropertyBase: 700_000,
    usedInterestBase: 900_000,
  },
  budgetBelowMinPayment: { ...base(), slipMonth: 0, freeMonthly: 20_000 },
  zeroLoan: { ...base(), slipMonth: 0, downPayment: 7_000_000 },
}

const isUpdateMode = process.env.UPDATE_GUEST_GOLDEN === '1'

if (isUpdateMode) {
  const data: Record<string, ReturnType<typeof projectGuest>> = {}
  for (const [name, params] of Object.entries(cases)) {
    data[name] = projectGuest(calculate(params))
  }
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true })
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(data, null, 2) + '\n')
}

const golden: Record<string, ReturnType<typeof projectGuest>> = isUpdateMode
  ? {}
  : JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))

describe('guestGolden', () => {
  for (const [name, params] of Object.entries(cases)) {
    const runner = isUpdateMode ? it.skip : it
    runner(`${name}: результат совпадает с зафиксированной golden-фикстурой`, () => {
      expect(projectGuest(calculate(params))).toEqual(golden[name])
    })
  }
})
