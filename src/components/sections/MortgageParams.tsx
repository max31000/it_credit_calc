import { memo, useCallback } from 'react'
import {
  Paper,
  Text,
  Divider,
  SimpleGrid,
  Stack,
  NumberInput,
  Alert,
  Group,
  Tooltip,
  ActionIcon,
  Box,
  Slider,
} from '@mantine/core'
import { IconInfoCircle, IconAlertTriangle } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { SliderField } from '../controls/SliderField'
import { MetricCard } from '../controls/MetricCard'
import { formatRub, formatPct } from '../../lib/formatters'

export const MortgageParams = memo(function MortgageParams() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const setParam = useCalculatorStore((s) => s.setParam)

  const loanAmount = result.loanAmount
  const downPaymentPct = Math.round((params.downPayment / params.apartmentPrice) * 100)
  const investMonthly = Math.max(0, params.freeMonthly - result.minPayment)

  const handleApartmentPrice = useCallback(
    (v: number) => {
      setParam('apartmentPrice', v)
      // keep downPayment pct constant when price changes
      const pct = downPaymentPct
      setParam('downPayment', Math.round((pct * v) / 100))
    },
    [setParam, downPaymentPct],
  )

  const handleDownPaymentPct = useCallback(
    (pct: number) => {
      setParam('downPayment', Math.round((pct * params.apartmentPrice) / 100))
    },
    [setParam, params.apartmentPrice],
  )

  const handleHorizonYears = useCallback(
    (v: number) => {
      const clamped = Math.min(v, params.termYears)
      setParam('horizonYears', clamped)
    },
    [setParam, params.termYears],
  )

  const handleSalary = useCallback(
    (v: string | number) => {
      const num = typeof v === 'string' ? parseFloat(v) : v
      if (!num || num <= 0) {
        setParam('salary', null)
      } else {
        setParam('salary', num)
      }
    },
    [setParam],
  )

  const salaryNumValue = params.salary ?? 0

  const ndflRateDisplay = result.tax ? `${(result.tax.ndflRate * 100).toFixed(0)}%` : 'Не указана'
  const totalDeduction =
    result.tax ? result.tax.deductionBuy + result.tax.deductionInterestTotal : 0
  const totalDeductionDisplay = result.tax ? formatRub(totalDeduction) : 'Укажите зарплату'

  const depositColor =
    params.depositRate > params.itRate + 3
      ? 'green'
      : params.depositRate >= params.itRate
        ? 'yellow'
        : 'red'

  const depositIndicator = (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor:
          depositColor === 'green'
            ? 'var(--mantine-color-green-6)'
            : depositColor === 'yellow'
              ? 'var(--mantine-color-yellow-5)'
              : 'var(--mantine-color-red-6)',
        marginLeft: 4,
        verticalAlign: 'middle',
      }}
    />
  )

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Text fw={600} size="lg">
        Параметры ипотеки
      </Text>
      <Divider mb="md" mt="xs" />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        {/* Left column */}
        <Stack gap="lg">
          <Stack gap={4}>
            <Group justify="space-between" align="center">
              <Text size="sm" fw={500}>Стоимость квартиры</Text>
              <NumberInput
                value={params.apartmentPrice}
                onChange={(v) => {
                  const num = typeof v === 'number' ? v : parseFloat(String(v))
                  if (!isNaN(num) && num >= 1_000_000 && num <= 20_000_000) {
                    handleApartmentPrice(num)
                  }
                }}
                min={1_000_000}
                max={20_000_000}
                step={100_000}
                thousandSeparator=" "
                suffix=" ₽"
                hideControls
                styles={{ input: { width: 150, textAlign: 'right', fontSize: 13, fontWeight: 600 } }}
                size="xs"
              />
            </Group>
            <Slider
              value={params.apartmentPrice}
              min={1_000_000}
              max={20_000_000}
              step={100_000}
              onChange={handleApartmentPrice}
              label={formatRub}
              marks={[
                { value: 1_000_000, label: '1M' },
                { value: 5_000_000, label: '5M' },
                { value: 10_000_000, label: '10M' },
                { value: 20_000_000, label: '20M' },
              ]}
              mb="lg"
            />
          </Stack>

          <Stack gap={4}>
            <Group justify="space-between" align="center">
              <Text size="sm" fw={500}>Первоначальный взнос</Text>
              <Group gap={6} align="center">
                <Text size="xs" c="dimmed">{downPaymentPct}%</Text>
                <NumberInput
                  value={params.downPayment}
                  onChange={(v) => {
                    const num = typeof v === 'number' ? v : parseFloat(String(v))
                    if (!isNaN(num) && num >= 0) {
                      const maxDown = params.apartmentPrice * 0.5
                      const clamped = Math.min(num, maxDown)
                      setParam('downPayment', Math.round(clamped))
                    }
                  }}
                  min={0}
                  max={params.apartmentPrice * 0.5}
                  step={100_000}
                  thousandSeparator=" "
                  suffix=" ₽"
                  hideControls
                  styles={{ input: { width: 150, textAlign: 'right', fontSize: 13, fontWeight: 600 } }}
                  size="xs"
                />
              </Group>
            </Group>
            <Slider
              value={downPaymentPct}
              min={10}
              max={50}
              step={1}
              onChange={handleDownPaymentPct}
              label={(v) => `${v}%`}
              marks={[
                { value: 10, label: '10%' },
                { value: 20, label: '20%' },
                { value: 30, label: '30%' },
                { value: 50, label: '50%' },
              ]}
              mb="lg"
            />
          </Stack>

          {/* Loan amount display */}
          <Paper bg="blue.0" p="sm" radius="sm">
            {loanAmount === 0 ? (
              <Group gap="xs">
                <Text size="xs" c="green.7" fw={500} tt="uppercase">
                  ✓ Кредит не требуется
                </Text>
              </Group>
            ) : (
              <>
                <Text size="xs" c="blue.7" fw={500} tt="uppercase">
                  Сумма кредита
                </Text>
                <Text size="xl" fw={700} c="blue.7">
                  {formatRub(loanAmount)}
                </Text>
              </>
            )}
          </Paper>

          <SliderField
            label="Льготная ставка ИТ-ипотеки"
            value={params.itRate}
            min={3}
            max={8}
            step={0.1}
            onChange={(v) => setParam('itRate', v)}
            format={formatPct}
            color="green"
            marks={[
              { value: 3, label: '3%' },
              { value: 5, label: '5%' },
              { value: 6.5, label: '6.5%' },
              { value: 8, label: '8%' },
            ]}
          />

          <SliderField
            label="Срок ипотеки"
            value={params.termYears}
            min={5}
            max={30}
            step={1}
            onChange={(v) => setParam('termYears', v)}
            format={(v) => `${v} лет`}
            marks={[
              { value: 5, label: '5 лет' },
              { value: 10, label: '10' },
              { value: 15, label: '15' },
              { value: 20, label: '20' },
              { value: 30, label: '30 лет' },
            ]}
          />
        </Stack>

        {/* Right column */}
        <Stack gap="lg">
          <Stack gap={4}>
            <SliderField
              label="Свободные деньги в месяц"
              value={params.freeMonthly}
              min={20_000}
              max={500_000}
              step={5_000}
              onChange={(v) => setParam('freeMonthly', v)}
              format={(v) => `${formatRub(v)}/мес`}
              secondaryLabel="Сумма поверх обязательного платежа, которую вы готовы направить на ипотечные цели"
              marks={[
                { value: 20_000, label: '20к' },
                { value: 100_000, label: '100к' },
                { value: 250_000, label: '250к' },
                { value: 500_000, label: '500к' },
              ]}
            />
            {params.freeMonthly < result.minPayment && (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mt="xs">
                <Text size="sm">
                  Свободные средства меньше минимального платежа ({formatRub(result.minPayment)}).
                  Обе стратегии идентичны.
                </Text>
              </Alert>
            )}
            {params.freeMonthly > result.minPayment && (
              <Text size="xs" c="dimmed">
                Инвестируется ежемесячно (стратегия Б): {formatRub(investMonthly)}
              </Text>
            )}
          </Stack>

          <Stack gap={4}>
            <Group gap={4} align="center" mb={4}>
              <Text size="sm" fw={500}>
                Доходность депозита / облигаций
              </Text>
              {depositIndicator}
            </Group>
            <SliderField
              label=""
              value={params.depositRate}
              min={6}
              max={25}
              step={0.5}
              onChange={(v) => setParam('depositRate', v)}
              format={(v) => `${v}% годовых`}
              marks={[
                { value: 6, label: '6%' },
                { value: 10, label: '10%' },
                { value: 16, label: '16%' },
                { value: 25, label: '25%' },
              ]}
            />
          </Stack>

          <Stack gap={4}>
            <SliderField
              label="Горизонт сравнения"
              value={params.horizonYears}
              min={3}
              max={25}
              step={1}
              onChange={handleHorizonYears}
              format={(v) => `${v} лет`}
              marks={[
                { value: 3, label: '3 г.' },
                { value: 5, label: '5' },
                { value: 10, label: '10' },
                { value: 15, label: '15' },
                { value: 25, label: '25 лет' },
              ]}
            />
            {params.horizonYears >= params.termYears && (
              <Text size="xs" c="dimmed">
                Ограничено сроком ипотеки
              </Text>
            )}
          </Stack>

          <Box>
            <Group gap={4} align="center" mb={4}>
              <Text size="sm" fw={500}>
                Зарплата до налогов (₽/мес)
              </Text>
              <Tooltip
                label="Ставка НДФЛ зависит от годового дохода. До 200 000 ₽/мес — 13%, до ~417 000 ₽/мес — 15%, выше — 18%."
                multiline
                w={280}
                withArrow
              >
                <ActionIcon variant="transparent" color="gray" size="xs" style={{ cursor: 'help' }}>
                  <IconInfoCircle size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <NumberInput
              value={salaryNumValue}
              onChange={handleSalary}
              min={0}
              max={10_000_000}
              step={1_000}
              placeholder="0"
              suffix=" ₽/мес"
              thousandSeparator=" "
              description="Для расчёта налоговых вычетов. 0 — не учитывать."
            />
            {params.salary !== null && params.salary > 0 && result.tax && (
              <Text size="xs" c="dimmed" mt={4}>
                Ставка НДФЛ: {(result.tax.ndflRate * 100).toFixed(0)}% → Максимальный вычет:{' '}
                {formatRub(result.tax.deductionBuy + result.tax.deductionInterestTotal)}
              </Text>
            )}
          </Box>
        </Stack>
      </SimpleGrid>

      {/* Metric cards */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mt="xl">
        <MetricCard
          label="Минимальный платёж"
          value={`${formatRub(result.minPayment)}/мес`}
          color="blue"
        />
        <MetricCard
          label="Переплата по плану"
          value={formatRub(result.totalInterest)}
          color="red"
          description="без досрочного погашения"
        />
        <MetricCard
          label="Ставка НДФЛ"
          value={ndflRateDisplay}
          color={result.tax ? 'orange' : 'gray'}
        />
        <MetricCard
          label="Налоговые вычеты"
          value={totalDeductionDisplay}
          color={result.tax ? 'green' : 'gray'}
          tooltip={
            result.tax
              ? `Имущественный вычет ${formatRub(result.tax.deductionBuy)} + Вычет по процентам ${formatRub(result.tax.deductionInterestTotal)}`
              : undefined
          }
        />
      </SimpleGrid>
    </Paper>
  )
})
