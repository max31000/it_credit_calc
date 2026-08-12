import { useState } from 'react'
import { Button, Group, NumberInput, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import type { MortgageEventKind, MortgageEventRequest } from '../../api/types'

const KIND_OPTIONS: Array<{ value: MortgageEventKind; label: string }> = [
  { value: 'balance', label: 'Фактический остаток (из выписки)' },
  { value: 'rate', label: 'Смена ставки' },
  { value: 'prepayment', label: 'Досрочный платёж' },
  { value: 'payment', label: 'Новый размер платежа' },
]

function todayPlusYear(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

interface EventFormProps {
  mortgageStartedOn: string
  submitting?: boolean
  onSubmit: (data: MortgageEventRequest) => void
  onCancel: () => void
}

export function EventForm({ mortgageStartedOn, submitting, onSubmit, onCancel }: EventFormProps) {
  const [kind, setKind] = useState<MortgageEventKind>('balance')
  const [occurredOn, setOccurredOn] = useState('')
  const [amount, setAmount] = useState<number | ''>('')
  const [rate, setRate] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const needsAmount = kind === 'balance' || kind === 'prepayment' || kind === 'payment'
  const needsRate = kind === 'rate'

  const validate = (): string | null => {
    if (!occurredOn) return 'Укажите дату'
    if (occurredOn < mortgageStartedOn) return 'Дата не может быть раньше даты оформления ипотеки'
    if (occurredOn > todayPlusYear()) return 'Дата не может быть дальше года вперёд'
    if (needsAmount && (amount === '' || Number(amount) <= 0)) return 'Укажите сумму больше нуля'
    if (needsRate && (rate === '' || Number(rate) <= 0 || Number(rate) > 100))
      return 'Ставка должна быть в диапазоне от 0 до 100%'
    if (note.length > 500) return 'Комментарий длиннее 500 символов'
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
      kind,
      occurredOn,
      amount: needsAmount ? Number(amount) : null,
      rate: needsRate ? Number(rate) : null,
      note: note.trim() ? note.trim() : null,
    })
  }

  return (
    <Stack gap="sm">
      <Select
        label="Вид корректировки"
        data={KIND_OPTIONS}
        value={kind}
        onChange={(v) => v && setKind(v as MortgageEventKind)}
        allowDeselect={false}
      />
      <TextInput
        label="Дата"
        type="date"
        value={occurredOn}
        onChange={(e) => setOccurredOn(e.currentTarget.value)}
        required
      />
      {needsAmount && (
        <NumberInput
          label="Сумма, ₽"
          value={amount}
          onChange={(v) => setAmount(typeof v === 'number' ? v : '')}
          min={0}
          thousandSeparator=" "
          suffix=" ₽"
        />
      )}
      {needsRate && (
        <NumberInput
          label="Новая ставка, % годовых"
          value={rate}
          onChange={(v) => setRate(typeof v === 'number' ? v : '')}
          min={0}
          max={100}
          step={0.1}
          decimalScale={3}
          suffix=" %"
        />
      )}
      <Textarea
        label="Комментарий"
        placeholder="необязательно"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        maxLength={500}
        autosize
        minRows={1}
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
          Добавить
        </Button>
      </Group>
    </Stack>
  )
}
