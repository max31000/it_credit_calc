import { Group, Text, Slider, Stack } from '@mantine/core'
import { useState, useEffect } from 'react'
import { InfoTooltip } from './InfoTooltip'

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format: (value: number) => string
  tooltip?: string
  secondaryLabel?: string
  color?: string
  marks?: Array<{ value: number; label?: string }>
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  tooltip,
  secondaryLabel,
  color,
  marks,
}: SliderFieldProps) {
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (v: number) => {
    setLocalValue(v)
    onChange(v)
  }

  return (
    <Stack gap={4}>
      <Group justify="space-between" align="center">
        <Group gap={4} align="center">
          <Text size="sm" fw={500}>
            {label}
          </Text>
          {tooltip && <InfoTooltip text={tooltip} />}
        </Group>
        <Text size="sm" fw={600} c="blue.7">
          {format(localValue)}
        </Text>
      </Group>
      <Slider
        value={localValue}
        min={min}
        max={max}
        step={step}
        onChange={handleChange}
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
