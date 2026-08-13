import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { NumberInput, type NumberInputProps } from '@mantine/core'

export interface NumericInputProps {
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  /** true — пустое поле валидно и коммитит null (зарплата, платёж по договору) */
  allowEmpty?: boolean
  /**
   * 'live' (по умолчанию) — `onChange` коммитит каждое валидное промежуточное число вживую.
   * 'blur' — `onChange` коммитится только на blur/Enter; полезно для полей, чьё значение
   * приводит к побочному пересчёту других полей (например, цена недвижимости в
   * `MortgageForm` — иначе релинк доли взноса срабатывает на каждый введённый разряд
   * и «уезжает» на огрызках вроде "7" → "75").
   */
  commitMode?: 'live' | 'blur'
  label?: ReactNode
  placeholder?: string
  description?: ReactNode
  step?: number
  suffix?: string
  thousandSeparator?: NumberInputProps['thousandSeparator']
  decimalScale?: number
  size?: NumberInputProps['size']
  styles?: NumberInputProps['styles']
  hideControls?: boolean
  required?: boolean
}

function parseDraft(draft: number | string): number {
  return typeof draft === 'number' ? draft : parseFloat(draft)
}

/**
 * Обёртка над Mantine `NumberInput` с локальным черновиком (жалоба 4, §7.2 спеки
 * docs/specs/2026-08-12-tracker-ux-design.md).
 *
 * Причина: `NumberInput.onChange` отдаёт строку вместо числа, когда введённое не
 * парсится в число или начинается с нулей (см. §7.1 спеки) — удаление первого символа
 * из "1 000 000" именно такой случай. Наивная обработка либо очищает поле (`''`), либо
 * клампит его на каждое нажатие до минимума. Здесь промежуточные состояния редактирования
 * живут только в локальном `draft` и наружу не выходят: `onChange` коммитит valid-число
 * в диапазоне вживую (графики двигаются при наборе), а клампинг/откат случаются только
 * на `blur`.
 */
export function NumericInput({
  value,
  onChange,
  min,
  max,
  allowEmpty = false,
  commitMode = 'live',
  ...rest
}: NumericInputProps) {
  const [draft, setDraft] = useState<number | string>(value ?? '')
  const [focused, setFocused] = useState(false)
  // "Adjusting state during render" (react.dev) вместо useEffect — синхронизация внешних
  // изменений в черновик, только пока поле не в фокусе (иначе дёргался бы курсор при наборе).
  // Откат несохранённого черновика делает commit() явно: сюда он не попадает, потому что
  // при отказе от коммита `value` не меняется и условие ниже ложно.
  const [syncedValue, setSyncedValue] = useState(value)
  if (!focused && value !== syncedValue) {
    setSyncedValue(value)
    setDraft(value ?? '')
  }

  const lo = min ?? -Infinity
  const hi = max ?? Infinity

  // Общий коммит черновика: клампинг + откат невалидного ввода. Используется на blur всегда,
  // а в commitMode 'blur' — ещё и на Enter (см. handleKeyDown).
  const commit = (raw: number | string) => {
    if (raw === '') {
      if (allowEmpty) onChange(null)
      // Иначе — откат черновика к текущему значению. Откатываем здесь явно: `value` при отказе
      // от коммита не меняется, поэтому синхронизация по `value !== syncedValue` не сработает,
      // и без этой строки поле показало бы пустой черновик при следующем фокусе.
      else setDraft(value ?? '')
      return
    }
    const parsed = parseDraft(raw)
    if (Number.isNaN(parsed)) {
      // Черновик вида "-" или "." — коммитить нечего, тот же явный откат.
      setDraft(value ?? '')
      return
    }
    const clamped = Math.min(hi, Math.max(lo, parsed))
    setDraft(clamped)
    onChange(clamped)
  }

  const handleChange = (v: number | string) => {
    setDraft(v)
    if (commitMode === 'live' && typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) {
      onChange(v)
    }
  }

  const handleBlur = () => {
    setFocused(false)
    commit(draft)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (commitMode === 'blur' && e.key === 'Enter') {
      commit(draft)
    }
  }

  return (
    <NumberInput
      {...rest}
      value={focused ? draft : (value ?? '')}
      onChange={handleChange}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      min={min}
      max={max}
      clampBehavior="none"
    />
  )
}
