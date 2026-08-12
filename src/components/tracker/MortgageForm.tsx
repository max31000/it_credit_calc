import { useState } from 'react'
import { Button, Group, NumberInput, Stack, Text, TextInput } from '@mantine/core'
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

/** Клиентская валидация зеркалит §3 спеки, чтобы 400 не был первым фидбеком пользователю. */
export function MortgageForm({ initial, submitting, onSubmit, onCancel }: MortgageFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [bank, setBank] = useState(initial?.bank ?? '')
  const [propertyPrice, setPropertyPrice] = useState<number | ''>(initial?.propertyPrice ?? '')
  const [downPayment, setDownPayment] = useState<number | ''>(initial?.downPayment ?? '')
  const [principal, setPrincipal] = useState<number | ''>(initial?.principal ?? '')
  const [rate, setRate] = useState<number | ''>(initial?.rate ?? '')
  const [termMonths, setTermMonths] = useState<number | ''>(initial?.termMonths ?? '')
  const [startedOn, setStartedOn] = useState(initial?.startedOn ?? new Date().toISOString().slice(0, 10))
  const [monthlyPayment, setMonthlyPayment] = useState<number | ''>(initial?.monthlyPayment ?? '')
  const [error, setError] = useState<string | null>(null)

  const validate = (): string | null => {
    if (!title.trim() || title.trim().length > 120) return 'Название обязательно, до 120 символов'
    if (bank && bank.length > 120) return 'Название банка длиннее 120 символов'
    if (propertyPrice === '' || Number(propertyPrice) <= 0)
      return 'Стоимость недвижимости должна быть больше нуля'
    if (downPayment === '' || Number(downPayment) < 0 || Number(downPayment) >= Number(propertyPrice))
      return 'Первоначальный взнос должен быть от 0 до стоимости недвижимости'
    if (principal === '' || Number(principal) <= 0 || Number(principal) > Number(propertyPrice))
      return 'Сумма кредита должна быть больше нуля и не больше стоимости недвижимости'
    if (rate === '' || Number(rate) <= 0 || Number(rate) > 100)
      return 'Ставка должна быть в диапазоне от 0 до 100%'
    if (termMonths === '' || Number(termMonths) < 1 || Number(termMonths) > 600)
      return 'Срок — от 1 до 600 месяцев'
    if (!startedOn || startedOn > todayPlusDay()) return 'Дата оформления не может быть в будущем'
    if (monthlyPayment !== '' && Number(monthlyPayment) <= 0)
      return 'Ежемесячный платёж должен быть больше нуля'
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
      propertyPrice: Number(propertyPrice),
      downPayment: Number(downPayment),
      principal: Number(principal),
      rate: Number(rate),
      termMonths: Number(termMonths),
      startedOn,
      monthlyPayment: monthlyPayment === '' ? null : Number(monthlyPayment),
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
      <NumberInput
        label="Стоимость недвижимости, ₽"
        value={propertyPrice}
        onChange={(v) => setPropertyPrice(typeof v === 'number' ? v : '')}
        min={0}
        thousandSeparator=" "
        suffix=" ₽"
      />
      <NumberInput
        label="Первоначальный взнос, ₽"
        value={downPayment}
        onChange={(v) => setDownPayment(typeof v === 'number' ? v : '')}
        min={0}
        thousandSeparator=" "
        suffix=" ₽"
      />
      <NumberInput
        label="Сумма кредита, ₽"
        value={principal}
        onChange={(v) => setPrincipal(typeof v === 'number' ? v : '')}
        min={0}
        thousandSeparator=" "
        suffix=" ₽"
      />
      <NumberInput
        label="Ставка, % годовых"
        value={rate}
        onChange={(v) => setRate(typeof v === 'number' ? v : '')}
        min={0}
        max={100}
        step={0.1}
        decimalScale={3}
        suffix=" %"
      />
      <NumberInput
        label="Срок, месяцев"
        value={termMonths}
        onChange={(v) => setTermMonths(typeof v === 'number' ? v : '')}
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
      <NumberInput
        label="Ежемесячный платёж, ₽"
        placeholder="посчитает трекер по договору, если не указать"
        value={monthlyPayment}
        onChange={(v) => setMonthlyPayment(typeof v === 'number' ? v : '')}
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
