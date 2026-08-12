import { memo, useMemo } from 'react'
import { Paper, Text, Tabs, Box, Stack } from '@mantine/core'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { IconChartLine, IconWallet, IconAlertTriangle } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { CHART_COLORS, formatYAxis, useChartTheme, xTickFormatter } from '../charts/chartUtils'
import { ChartTooltip } from '../charts/ChartTooltip'
import { formatRub } from '../../lib/formatters'

/** Общие пропсы осей и сетки */
function ChartFrame({
  children,
  data,
  height = 300,
}: {
  children: React.ReactNode
  data: Array<Record<string, number>>
  height?: number
}) {
  const { gridColor, tickColor } = useChartTheme()
  return (
    <Box style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 24, right: 24, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="month" tickFormatter={xTickFormatter} tick={{ fontSize: 12, fill: tickColor }} />
          <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12, fill: tickColor }} width={65} />
          {children}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  )
}

function NetWorthTab() {
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())

  const data = useMemo(
    () =>
      result.series.map((pt) => ({
        month: pt.month,
        netWorthPrepay: pt.netWorthPrepay,
        netWorthSave: pt.netWorthSave,
      })),
    [result.series],
  )

  const showSlip = result.slip !== null && effectiveSlipMonth > 0

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Капитал = накопления − остаток долга. Чем выше линия, тем ближе вы к жизни без ипотеки.
        {showSlip && ' Излом на линиях — момент слёта.'}
      </Text>
      <ChartFrame data={data}>
        <Tooltip content={<ChartTooltip />} />
        <Legend />
        <ReferenceLine y={0} stroke={CHART_COLORS.neutral} strokeDasharray="4 4" strokeWidth={1} />
        {showSlip && (
          <ReferenceLine
            x={effectiveSlipMonth}
            stroke={CHART_COLORS.slip}
            strokeDasharray="6 3"
            strokeWidth={2}
            label={{ value: 'Слёт', fill: CHART_COLORS.slip, fontSize: 11, position: 'top' }}
          />
        )}
        <Line
          type="monotone"
          dataKey="netWorthPrepay"
          stroke={CHART_COLORS.prepay}
          strokeWidth={2.5}
          dot={false}
          name="Гасить досрочно"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="netWorthSave"
          stroke={CHART_COLORS.save}
          strokeWidth={2.5}
          dot={false}
          name="Копить"
          isAnimationActive={false}
        />
      </ChartFrame>
    </Stack>
  )
}

function BalancesTab() {
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())

  const data = useMemo(
    () =>
      result.series.map((pt) => ({
        month: pt.month,
        debtSave: pt.debtSave,
        savingsSave: pt.savingsSave,
        debtPrepay: pt.debtPrepay,
      })),
    [result.series],
  )

  const showSlip = result.slip !== null && effectiveSlipMonth > 0

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Точка, где накопления пересекают долг, — момент, когда ипотеку можно закрыть целиком.
      </Text>
      <ChartFrame data={data}>
        <Tooltip content={<ChartTooltip />} />
        <Legend />
        {showSlip && (
          <ReferenceLine
            x={effectiveSlipMonth}
            stroke={CHART_COLORS.slip}
            strokeDasharray="6 3"
            strokeWidth={2}
            label={{ value: 'Слёт', fill: CHART_COLORS.slip, fontSize: 11, position: 'top' }}
          />
        )}
        {result.payoffMonth !== null && !showSlip && (
          <ReferenceLine
            x={result.payoffMonth}
            stroke={CHART_COLORS.payoff}
            strokeDasharray="6 3"
            strokeWidth={2}
            label={{
              value: 'Хватает на закрытие',
              fill: CHART_COLORS.payoff,
              fontSize: 11,
              position: 'top',
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="savingsSave"
          stroke={CHART_COLORS.savingsLine}
          strokeWidth={2.5}
          dot={false}
          name="Накопления (копить)"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="debtSave"
          stroke={CHART_COLORS.save}
          strokeWidth={2}
          strokeDasharray="8 4"
          dot={false}
          name="Долг (копить)"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="debtPrepay"
          stroke={CHART_COLORS.prepay}
          strokeWidth={2}
          strokeDasharray="8 4"
          dot={false}
          name="Долг (гасить досрочно)"
          isAnimationActive={false}
        />
      </ChartFrame>
    </Stack>
  )
}

function SlipRiskTab() {
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())

  const data = useMemo(
    () =>
      result.slipAnalysis.map((pt) => ({
        month: pt.slipMonth,
        paymentWithoutPrepay: pt.paymentWithoutPrepay,
        paymentWithPrepay: pt.paymentWithPrepay,
      })),
    [result.slipAnalysis],
  )

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Ось X — момент возможного слёта, а не время. Для каждого месяца показан платёж, который
        возник бы при слёте именно в этот месяц: с внесением всех накоплений в долг и без него.
      </Text>
      <ChartFrame data={data}>
        <Tooltip
          content={
            <ChartTooltip
              labelPrefix="Если слёт в мес."
              footer={`Льготный платёж: ${formatRub(result.minPayment)}`}
            />
          }
        />
        <Legend />
        <ReferenceLine
          y={result.minPayment}
          stroke={CHART_COLORS.payoff}
          strokeWidth={2}
          label={{
            value: 'Льготный платёж',
            fill: CHART_COLORS.payoff,
            fontSize: 11,
            position: 'insideTopLeft',
          }}
        />
        {result.safetyMonth !== null && (
          <ReferenceLine
            x={result.safetyMonth}
            stroke={CHART_COLORS.safety}
            strokeWidth={2}
            label={{
              value: 'Точка безопасности',
              fill: CHART_COLORS.safety,
              fontSize: 11,
              position: 'top',
            }}
          />
        )}
        {effectiveSlipMonth > 0 && effectiveSlipMonth <= data.length && (
          <ReferenceLine
            x={effectiveSlipMonth}
            stroke={CHART_COLORS.neutral}
            strokeDasharray="6 3"
            label={{
              value: 'Слёт',
              fill: CHART_COLORS.neutral,
              fontSize: 11,
              position: 'insideBottomLeft',
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="paymentWithoutPrepay"
          stroke={CHART_COLORS.danger}
          strokeWidth={2.5}
          dot={false}
          name="Платёж без внесения накоплений"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="paymentWithPrepay"
          stroke={CHART_COLORS.save}
          strokeWidth={2.5}
          dot={false}
          name="Платёж после внесения накоплений"
          isAnimationActive={false}
        />
      </ChartFrame>
    </Stack>
  )
}

export const ChartsSection = memo(function ChartsSection() {
  const loanAmount = useCalculatorStore((s) => s.result.loanAmount)
  if (loanAmount === 0) return null

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Tabs defaultValue="networth" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="networth" leftSection={<IconChartLine size={16} />}>
            Капитал
          </Tabs.Tab>
          <Tabs.Tab value="balances" leftSection={<IconWallet size={16} />}>
            Долг и накопления
          </Tabs.Tab>
          <Tabs.Tab value="sliprisk" leftSection={<IconAlertTriangle size={16} />}>
            Риск слёта
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="networth">
          <NetWorthTab />
        </Tabs.Panel>
        <Tabs.Panel value="balances">
          <BalancesTab />
        </Tabs.Panel>
        <Tabs.Panel value="sliprisk">
          <SlipRiskTab />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  )
})
