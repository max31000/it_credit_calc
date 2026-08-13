/**
 * Связанные поля цена / взнос / кредит (жалоба 3, §6 спеки
 * docs/specs/2026-08-12-tracker-ux-design.md). Общая чистая логика для калькулятора
 * (`ParamsSection`) и формы ипотеки (`MortgageForm`) — эти три числа в договоре
 * ипотеки всегда связаны, независимый ввод даёт несогласующуюся тройку.
 */

export interface LoanTriple {
  propertyPrice: number
  downPayment: number
  principal: number
}

export type LoanField = keyof LoanTriple

/**
 * Инвариант на выходе всегда: `principal === propertyPrice − downPayment`, все ≥ 0.
 *
 * - `propertyPrice` меняется → сохраняется доля взноса от предыдущей тройки
 *   (при `prev.propertyPrice === 0` доля берётся 0.2 по умолчанию);
 * - `downPayment` меняется → клампится в `[0, price]`, кредит пересчитывается;
 * - `principal` меняется → клампится в `[0, price]`, взнос пересчитывается.
 */
export function relinkLoan(prev: LoanTriple, field: LoanField, value: number): LoanTriple {
  if (field === 'propertyPrice') {
    const price = Math.max(0, value)
    const pct = prev.propertyPrice > 0 ? prev.downPayment / prev.propertyPrice : 0.2
    const downPayment = Math.round(pct * price)
    return { propertyPrice: price, downPayment, principal: price - downPayment }
  }

  if (field === 'downPayment') {
    const downPayment = Math.min(Math.max(0, value), prev.propertyPrice)
    return { propertyPrice: prev.propertyPrice, downPayment, principal: prev.propertyPrice - downPayment }
  }

  // field === 'principal'
  const principal = Math.min(Math.max(0, value), prev.propertyPrice)
  return { propertyPrice: prev.propertyPrice, downPayment: prev.propertyPrice - principal, principal }
}
