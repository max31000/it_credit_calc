import { useState } from 'react'
import { Button, Group, Stack, Text, TextInput } from '@mantine/core'
import { NumericInput } from '../controls/NumericInput'
import { relinkLoan, type LoanTriple } from '../../lib/loanLink'
import type { MortgageRequest } from '../../api/types'

function todayPlusDay(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

interface MortgageFormProps {
  /** Начальные значения — префилл из калькулятора или существующая ипотека при редактировании */
  initial?: Partial<MortgageRequest>
  submitting?: boolean
  onSubmit: (data: MortgageRequest) => void
  onCancel: () => void
}

/**
 * Клиентская валидация зеркалит §3 спеки, чтобы 400 не был первым фидбеком пользователю.
 * Цена/взнос/кредит связаны через `relinkLoan` (§6 спеки) — сохранить несогласующуюся
 * тройку через UI нельзя, независимая валидация остаётся только страховкой.
 */
export function MortgageForm({ initial, submitting, onSubmit, onCancel }: MortgageFormProps) {
  // G10: префилл из калькулятора не содержит title — первое, что видит пользователь,
  // не должно быть ошибкой валидации.
  const [title, setTitle] = useState(initial?.title ?? (initial ? 'Моя ипотека' : ''))
  const [bank, setBank] = useState(initial?.bank ?? '')
  // При создании (нет `initial`) поля стартуют черновиками-пустыми (null), а не нулями —
  // заполнять можно только сверху вниз: цена → взнос/кредит (жалоба 4 ревью). При префилле
  // из калькулятора или редактировании существующей ипотеки значения уже заданы, как раньше.
  const [loan, setLoan] = useState<{
    propertyPrice: number | null
    downPayment: number | null
    principal: number | null
  }>({
    propertyPrice: initial?.propertyPrice ?? null,
    downPayment: initial?.downPayment ?? null,
    principal: initial?.principal ?? null,
  })
  const [rate, setRate] = useState<number | null>(initial?.rate ?? null)
  const [termMonths, setTermMonths] = useState<number | null>(initial?.termMonths ?? null)
  const [startedOn, setStartedOn] = useState(initial?.startedOn ?? new Date().toISOString().slice(0, 10))
  const [monthlyPayment, setMonthlyPayment] = useState<number | null>(initial?.monthlyPayment ?? null)
  const [error, setError] = useState<string | null>(null)

  const handleLoanField = (field: keyof LoanTriple) => (v: number | null) => {
    if (v === null) return
    setLoan((prev) => {
      // Пока цена не задана (>0), relinkLoan для взноса/кредита не запускаем — иначе
      // расчёт делит на несуществующую цену и схлопывает поле в 0 (жалоба 4 ревью).
      // Поле просто хранит то, что ввёл пользователь; связка стартует, когда появится цена.
      if (field !== 'propertyPrice' && (prev.propertyPrice === null || prev.propertyPrice <= 0)) {
        return { ...prev, [field]: v }
      }
      const numericPrev: LoanTriple = {
        propertyPrice: prev.propertyPrice ?? 0,
        downPayment: prev.downPayment ?? 0,
        principal: prev.principal ?? 0,
      }
      return relinkLoan(numericPrev, field, v)
    })
  }

  const validate = (): string | null => {
    if (!title.trim() || title.trim().length > 120) return 'Название обязательно, до 120 символов'
    if (bank && bank.length > 120) return 'Название банка длиннее 120 символов'
    if (loan.propertyPrice === null || loan.propertyPrice <= 0) return 'Стоимость недвижимости должна быть больше нуля'
    if (loan.downPayment === null || loan.downPayment < 0 || loan.downPayment >= loan.propertyPrice)
      return 'Первоначальный взнос должен быть от 0 до стоимости недвижимости'
    if (loan.principal === null || loan.principal <= 0 || loan.principal > loan.propertyPrice)
      return 'Сумма кредита должна быть больше нуля и не больше стоимости недвижимости'
    if (rate === null || rate <= 0 || rate > 100) return 'Ставка должна быть в диапазоне от 0 до 100%'
    if (termMonths === null || termMonths < 1 || termMonths > 600) return 'Срок — от 1 до 600 месяцев'
    if (!startedOn || startedOn > todayPlusDay()) return 'Дата оформления не может быть в будущем'
    if (monthlyPayment !== null && monthlyPayment <= 0) return 'Ежемесячный платёж должен быть больше нуля'
    return null
  }

  const handleSubmit = () => {
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    setError(null)
    onSubmit({
      title: title.trim(),
      bank: bank.trim() ? bank.trim() : null,
      propertyPrice: loan.propertyPrice as number,
      downPayment: loan.downPayment as number,
      principal: loan.principal as number,
      rate: rate as number,
      termMonths: termMonths as number,
      startedOn,
      monthlyPayment,
    })
  }

  return (
    <Stack gap="sm">
      <TextInput
        label="Название"
        placeholder="Квартира на Ленина"
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        required
      />
      <TextInput
        label="Банк"
        placeholder="необязательно"
        value={bank ?? ''}
        onChange={(e) => setBank(e.currentTarget.value)}
      />
      <NumericInput
        label="Стоимость недвижимости, ₽"
        value={loan.propertyPrice}
        onChange={handleLoanField('propertyPrice')}
        min={0}
        commitMode="blur"
        thousandSeparator=" "
        suffix=" ₽"
      />
      <NumericInput
        label="Первоначальный взнос, ₽"
        value={loan.downPayment}
        onChange={handleLoanField('downPayment')}
        min={0}
        max={loan.propertyPrice !== null && loan.propertyPrice > 0 ? loan.propertyPrice : undefined}
        thousandSeparator=" "
        suffix=" ₽"
      />
      <NumericInput
        label="Сумма кредита, ₽"
        value={loan.principal}
        onChange={handleLoanField('principal')}
        min={0}
        max={loan.propertyPrice !== null && loan.propertyPrice > 0 ? loan.propertyPrice : undefined}
        thousandSeparator=" "
        suffix=" ₽"
      />
      <NumericInput
        label="Ставка, % годовых"
        value={rate}
        onChange={setRate}
        allowEmpty
        min={0}
        max={100}
        step={0.1}
        decimalScale={3}
        suffix=" %"
      />
      <NumericInput
        label="Срок, месяцев"
        value={termMonths}
        onChange={setTermMonths}
        allowEmpty
        min={1}
        max={600}
      />
      <TextInput
        label="Дата оформления"
        type="date"
        value={startedOn}
        onChange={(e) => setStartedOn(e.currentTarget.value)}
        required
      />
      <NumericInput
        label="Ежемесячный платёж, ₽"
        placeholder="посчитает трекер по договору, если не указать"
        value={monthlyPayment}
        onChange={setMonthlyPayment}
        allowEmpty
        min={0}
        thousandSeparator=" "
        suffix=" ₽"
      />
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          Отмена
        </Button>
        <Button onClick={handleSubmit} loading={submitting}>
          Сохранить
        </Button>
      </Group>
    </Stack>
  )
}
