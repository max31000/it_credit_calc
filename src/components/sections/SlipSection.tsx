import { memo } from 'react'
import { Paper, Text, Divider, Stack, Group, ThemeIcon, Alert } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { SliderInput } from '../controls/SliderInput'
import { formatPct, formatMonths } from '../../lib/formatters'

export const SlipSection = memo(function SlipSection() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const setParam = useCalculatorStore((s) => s.setParam)

  const maxSlipMonth = params.termYears * 12
  const horizonMonths = params.horizonYears * 12
  const slipBeyondHorizon = params.slipMonth > horizonMonths

  const slipSecondaryLabel =
    params.slipMonth === 0
      ? 'Слёт не моделируется — базовый сценарий'
      : `Через ${formatMonths(params.slipMonth)} после начала ипотеки`

  const yearMarks = [4, 8, 12, 16, 20, 25, 30]
    .map((y) => ({ value: y * 12, label: `${y} л.` }))
    .filter((m) => m.value <= maxSlipMonth)

  return (
    <Paper
      p="lg"
      shadow="sm"
      radius="md"
      style={{ borderLeft: '4px solid var(--mantine-color-orange-6)' }}
    >
      <Group gap="xs" mb="xs">
        <ThemeIcon color="orange" variant="light" size="md">
          <IconAlertTriangle size={16} />
        </ThemeIcon>
        <Text fw={600} size="lg">
          Сценарий слёта с льготной программы
        </Text>
      </Group>
      <Text size="sm" c="dimmed">
        Если льгота теряется, банк переводит кредит на рыночную ставку. В расчёте при слёте все
        накопления сразу вносятся в досрочное погашение, дальше жизнь идёт по новым условиям.
        Последствия — в «Выводах» ниже.
      </Text>
      <Divider mb="md" mt="xs" />

      <Stack gap="lg">
        <Stack gap={4}>
          <SliderInput
            label="Месяц слёта"
            value={params.slipMonth}
            min={0}
            max={maxSlipMonth}
            step={1}
            onChange={(v) => setParam('slipMonth', v)}
            format={(v) => (v === 0 ? 'Слёта нет' : `Месяц ${v}`)}
            suffix=" мес"
            secondaryLabel={slipSecondaryLabel}
            color="orange"
            marks={[{ value: 0, label: '0' }, ...yearMarks]}
          />
          {slipBeyondHorizon && (
            <Alert color="blue" variant="light">
              Слёт задан позже горизонта сравнения ({params.horizonYears} лет) — на расчёт он не
              влияет. Увеличьте горизонт или сдвиньте месяц слёта.
            </Alert>
          )}
        </Stack>

        <SliderInput
          label="Ключевая ставка на момент слёта"
          value={params.keyRate}
          min={4}
          max={30}
          step={0.25}
          onChange={(v) => setParam('keyRate', v)}
          format={formatPct}
          suffix=" %"
          decimalScale={2}
          color="red"
          marks={[
            { value: 4, label: '4%' },
            { value: 10, label: '10%' },
            { value: 16, label: '16%' },
            { value: 23, label: '23%' },
            { value: 30, label: '30%' },
          ]}
        />

        <SliderInput
          label="Дисконт банка"
          value={params.bankDiscount}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => setParam('bankDiscount', v)}
          format={formatPct}
          suffix=" %"
          decimalScale={1}
          tooltip="Дисконт к ключевой ставке при смене условий, обычно 0,5%. Рыночная ставка = ключевая − дисконт + 1,5%."
          marks={[
            { value: 0, label: '0%' },
            { value: 0.5, label: '0,5%' },
            { value: 1, label: '1%' },
            { value: 2, label: '2%' },
          ]}
        />

        <Text size="sm" c="dimmed">
          Рыночная ставка после слёта:{' '}
          <Text span fw={600} c="red.7">
            {formatPct(result.marketRateAtSlip)}
          </Text>{' '}
          ({params.keyRate}% − {params.bankDiscount}% + 1,5%)
        </Text>
      </Stack>
    </Paper>
  )
})
