import { Group, Text, Slider, Stack, NumberInput } from '@mantine/core'
import type { ReactNode } from 'react'
import { InfoTooltip } from './InfoTooltip'

interface SliderInputProps {
  label: string
  value: number
  /** Границы слайдера */
  min: number
  max: number
  step: number
  /** Верхняя граница ручного ввода (по умолчанию = max слайдера) */
  inputMax?: number
  /** Нижняя граница ручного ввода (по умолчанию = min слайдера) */
  inputMin?: number
  /** Шаг стрелок в поле ввода (по умолчанию = step) */
  inputStep?: number
  onChange: (value: number) => void
  /** Подпись значения на слайдере */
  format: (value: number) => string
  /** Суффикс поля ввода, например " ₽" */
  suffix?: string
  decimalScale?: number
  tooltip?: string
  secondaryLabel?: ReactNode
  color?: string
  marks?: Array<{ value: number; label?: string }>
  /** Дополнительный элемент справа от поля ввода (например, процент) */
  rightHint?: ReactNode
}

/**
 * Слайдер с точным числовым вводом. Слайдер задаёт удобный диапазон,
 * поле ввода позволяет ввести точное значение (в т.ч. за пределами слайдера).
 */
export function SliderInput({
  label,
  value,
  min,
  max,
  step,
  inputMax,
  inputMin,
  inputStep,
  onChange,
  format,
  suffix,
  decimalScale = 0,
  tooltip,
  secondaryLabel,
  color,
  marks,
  rightHint,
}: SliderInputProps) {
  const commitInput = (v: number | string) => {
    const num = typeof v === 'number' ? v : parseFloat(v)
    if (isNaN(num)) return
    const lo = inputMin ?? min
    const hi = inputMax ?? max
    onChange(Math.min(hi, Math.max(lo, num)))
  }

  return (
    <Stack gap={4}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap={4} align="center" wrap="nowrap">
          <Text size="sm" fw={500}>
            {label}
          </Text>
          {tooltip && <InfoTooltip text={tooltip} />}
        </Group>
        <Group gap={6} align="center" wrap="nowrap">
          {rightHint}
          <NumberInput
            value={value}
            onChange={commitInput}
            min={inputMin ?? min}
            max={inputMax ?? max}
            step={inputStep ?? step}
            thousandSeparator=" "
            suffix={suffix}
            decimalScale={decimalScale}
            hideControls
            size="xs"
            styles={{ input: { width: 140, textAlign: 'right', fontSize: 13, fontWeight: 600 } }}
          />
        </Group>
      </Group>
      <Slider
        value={Math.min(max, Math.max(min, value))}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        label={format}
        color={color}
        marks={marks}
        mb={marks ? 'lg' : undefined}
      />
      {secondaryLabel && (
        <Text size="xs" c="dimmed">
          {secondaryLabel}
        </Text>
      )}
    </Stack>
  )
}
