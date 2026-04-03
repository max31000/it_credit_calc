import { memo } from 'react'
import {
  Paper,
  Text,
  Divider,
  SimpleGrid,
  Stack,
  Alert,
  Group,
  ThemeIcon,
} from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { SliderField } from '../controls/SliderField'
import { MetricCard } from '../controls/MetricCard'
import { formatRub, formatPct, formatMonths } from '../../lib/formatters'

export const SlipParams = memo(function SlipParams() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const setParam = useCalculatorStore((s) => s.setParam)

  const maxSlipMonth = params.termYears * 12

  const slipSecondaryLabel =
    params.slipMonth === 0
      ? 'Слёт не происходит — рассчитывается базовый сценарий'
      : `Через ${formatMonths(params.slipMonth)} после начала ипотеки`

  const slipMarks = [
    { value: 0, label: 'Сейчас' },
    ...Array.from({ length: params.termYears }, (_, i) => ({
      value: (i + 1) * 12,
      label: `${i + 1} г.`,
    })),
  ].filter((m) => m.value <= maxSlipMonth)

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
          Сценарий слёта с ИТ-ипотеки
        </Text>
      </Group>
      <Text size="sm" c="dimmed">
        Моделирование ситуации, когда льготная программа прекращается и банк переводит кредит на
        рыночные условия.
      </Text>
      <Divider mb="md" mt="xs" />

      <Stack gap="lg">
        <SliderField
          label="Месяц слёта"
          value={params.slipMonth}
          min={0}
          max={maxSlipMonth}
          step={1}
          onChange={(v) => setParam('slipMonth', v)}
          format={(v) => (v === 0 ? 'Слёт не происходит' : `Месяц ${v}`)}
          secondaryLabel={slipSecondaryLabel}
          color="orange"
          marks={slipMarks.slice(0, 7)} // limit marks to avoid overflow
        />

        <SliderField
          label="Ключевая ставка при слёте"
          value={params.keyRate}
          min={8}
          max={25}
          step={0.5}
          onChange={(v) => setParam('keyRate', v)}
          format={formatPct}
          color="red"
          marks={[
            { value: 8, label: '8%' },
            { value: 13, label: '13%' },
            { value: 16, label: '16%' },
            { value: 21, label: '21%' },
            { value: 25, label: '25%' },
          ]}
        />

        <SliderField
          label="Дисконт банка"
          value={params.bankDiscount}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => setParam('bankDiscount', v)}
          format={formatPct}
          tooltip="Дисконт к ключевой ставке, который банк применяет при смене условий. Обычно 0,5%. Итоговая ставка = ключевая − дисконт + 1,5%"
          marks={[
            { value: 0, label: '0%' },
            { value: 0.5, label: '0,5%' },
            { value: 1, label: '1%' },
            { value: 2, label: '2%' },
          ]}
        />
      </Stack>

      {params.slipMonth === 0 ? (
        <Alert color="blue" mt="md">
          Выберите момент слёта для расчёта сценария
        </Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mt="lg">
          <MetricCard
            label="Рыночная ставка при слёте"
            value={formatPct(result.marketRateAtSlip)}
            color="red"
            description={`${params.keyRate}% − ${params.bankDiscount}% + 1,5%`}
          />
          <MetricCard
            label="Платёж при слёте БЕЗ досрочки"
            value={`${formatRub(result.slipScenario.paymentWithoutPrepay)}/мес`}
            color="red"
            description="Только обязательный аннуитет по рыночной ставке"
            bg="red.0"
          />
          <MetricCard
            label="Платёж при слёте со стратегией А"
            value={`${formatRub(result.slipScenario.paymentWithPrepay)}/мес`}
            color="blue"
            description="После применения накоплений к долгу"
            bg="blue.0"
          />
        </SimpleGrid>
      )}
    </Paper>
  )
})
