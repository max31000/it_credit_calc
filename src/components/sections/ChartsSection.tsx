import { memo, useMemo, useState } from 'react'
import { Paper, Text, Tabs, Box, Stack, Group, SegmentedControl } from '@mantine/core'
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
import { buildTimeline, toAbsolute, sliceFromToday, type Timeline, type TimelinePoint } from '../../lib/timeline'

type TimelineDisplayMode = 'full' | 'forecast'

/** Общие пропсы осей и сетки */
function ChartFrame({
  children,
  data,
  height = 300,
}: {
  children: React.ReactNode
  data: Array<Record<string, number | null>>
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

/** Вертикаль «Сегодня» — общая для всех трёх вкладок при наличии истории (§5.2 дизайна) */
function TodayReferenceLine({ month }: { month: number }) {
  return (
    <ReferenceLine
      x={month}
      stroke={CHART_COLORS.neutral}
      strokeWidth={2}
      label={{ value: 'Сегодня', fill: CHART_COLORS.neutral, fontSize: 11, position: 'top' }}
    />
  )
}

interface TimelineTabProps {
  points: TimelinePoint[]
  timeline: Timeline
}

function NetWorthTab({ points, timeline }: TimelineTabProps) {
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())

  const data = useMemo(
    () =>
      points.map((pt) => ({
        month: pt.month,
        netWorthPrepay: pt.netWorthPrepay,
        netWorthSave: pt.netWorthSave,
        netWorthFact: pt.netWorthFact,
      })),
    [points],
  )

  const showSlip = result.slip !== null && effectiveSlipMonth > 0

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Капитал = накопления − остаток долга. Чем выше линия, тем ближе вы к жизни без ипотеки.
        {showSlip && ' Излом на линиях — момент слёта.'}
        {timeline.hasHistory &&
          ' До сегодня трекер знает только долг, поэтому серая линия — нижняя граница капитала. Ступенька на «Сегодня» — ваши текущие накопления.'}
      </Text>
      <ChartFrame data={data}>
        <Tooltip
          content={
            <ChartTooltip
              todayMonth={timeline.hasHistory ? timeline.todayMonth : undefined}
              startedOn={timeline.startedOn}
            />
          }
        />
        <Legend />
        <ReferenceLine y={0} stroke={CHART_COLORS.neutral} strokeDasharray="4 4" strokeWidth={1} />
        {timeline.hasHistory && <TodayReferenceLine month={timeline.todayMonth} />}
        {showSlip && (
          <ReferenceLine
            x={toAbsolute(timeline, effectiveSlipMonth)}
            stroke={CHART_COLORS.slip}
            strokeDasharray="6 3"
            strokeWidth={2}
            label={{ value: 'Слёт', fill: CHART_COLORS.slip, fontSize: 11, position: 'top' }}
          />
        )}
        {timeline.hasHistory && (
          <Line
            type="monotone"
            dataKey="netWorthFact"
            stroke={CHART_COLORS.neutral}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            name="Капитал без учёта накоплений (факт)"
            isAnimationActive={false}
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

function BalancesTab({ points, timeline }: TimelineTabProps) {
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())

  const data = useMemo(
    () =>
      points.map((pt) => ({
        month: pt.month,
        debtSave: pt.debtSave,
        savingsSave: pt.savingsSave,
        debtPrepay: pt.debtPrepay,
        debtFact: pt.debtFact,
      })),
    [points],
  )

  const showSlip = result.slip !== null && effectiveSlipMonth > 0
  // payoffMonth === 0 совпал бы с вертикалью «Сегодня» — линию не рисуем, об этом говорит
  // карточка выводов (§5.3 дизайна).
  const showPayoff = result.payoffMonth !== null && result.payoffMonth !== 0 && !showSlip

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Точка, где накопления пересекают долг, — момент, когда ипотеку можно закрыть целиком.
      </Text>
      <ChartFrame data={data}>
        <Tooltip
          content={
            <ChartTooltip
              todayMonth={timeline.hasHistory ? timeline.todayMonth : undefined}
              startedOn={timeline.startedOn}
            />
          }
        />
        <Legend />
        {timeline.hasHistory && <TodayReferenceLine month={timeline.todayMonth} />}
        {showSlip && (
          <ReferenceLine
            x={toAbsolute(timeline, effectiveSlipMonth)}
            stroke={CHART_COLORS.slip}
            strokeDasharray="6 3"
            strokeWidth={2}
            label={{ value: 'Слёт', fill: CHART_COLORS.slip, fontSize: 11, position: 'top' }}
          />
        )}
        {showPayoff && (
          <ReferenceLine
            x={toAbsolute(timeline, result.payoffMonth as number)}
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
        {timeline.hasHistory && (
          <Line
            type="monotone"
            dataKey="debtFact"
            stroke={CHART_COLORS.neutral}
            strokeWidth={2.5}
            dot={false}
            name="Долг (факт)"
            isAnimationActive={false}
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

function SlipRiskTab({ timeline }: { timeline: Timeline }) {
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())

  const data = useMemo(
    () =>
      timeline.slipPoints.map((pt) => ({
        month: pt.month,
        paymentWithoutPrepay: pt.paymentWithoutPrepay,
        paymentWithPrepay: pt.paymentWithPrepay,
      })),
    [timeline.slipPoints],
  )

  const axisCaption = timeline.hasHistory
    ? 'Ось X — момент возможного слёта в месяцах от выдачи ипотеки.'
    : 'Ось X — момент возможного слёта, а не время.'

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {axisCaption} Для каждого месяца показан платёж, который возник бы при слёте именно в
        этот месяц: с внесением всех накоплений в долг и без него.
      </Text>
      <ChartFrame data={data}>
        <Tooltip
          content={
            <ChartTooltip
              labelPrefix="Если слёт в мес."
              footer={`Льготный платёж: ${formatRub(result.minPayment)}`}
              todayMonth={timeline.hasHistory ? timeline.todayMonth : undefined}
              startedOn={timeline.startedOn}
            />
          }
        />
        <Legend />
        {/* Вертикаль «Сегодня» здесь оставлена для единообразия с двумя другими вкладками,
            но осознанно не появляется на экране: ось X этой вкладки — не время, а месяц
            возможного слёта, и `timeline.slipPoints` начинается с `todayMonth + 1` (слёт
            «в этом месяце» — уже следующий месяц, см. §3.3 дизайна). Координата todayMonth
            лежит за пределами категорий данных графика, поэтому recharts молча не рисует
            ReferenceLine на такой x — это не баг, чинить пересчётом домена не нужно. */}
        {timeline.hasHistory && <TodayReferenceLine month={timeline.todayMonth} />}
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
            x={toAbsolute(timeline, result.safetyMonth)}
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
        {effectiveSlipMonth > 0 && effectiveSlipMonth <= result.slipAnalysis.length && (
          <ReferenceLine
            x={toAbsolute(timeline, effectiveSlipMonth)}
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
  const result = useCalculatorStore((s) => s.result)
  const linkedMortgage = useCalculatorStore((s) => s.linkedMortgage)
  const [timelineMode, setTimelineMode] = useState<TimelineDisplayMode>('full')

  // Единый пересчёт «история + прогноз» на весь блок графиков (§5.1 дизайна) — раздаётся
  // во вкладки пропсами вместо трёх отдельных useMemo, как было раньше.
  const timeline = useMemo(
    () => buildTimeline(result, linkedMortgage?.history ?? null, linkedMortgage?.startedOn ?? null),
    [result, linkedMortgage?.history, linkedMortgage?.startedOn],
  )

  const points = useMemo(
    () => (timelineMode === 'forecast' ? sliceFromToday(timeline) : timeline.points),
    [timeline, timelineMode],
  )

  if (result.loanAmount === 0) return null

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Tabs defaultValue="networth" keepMounted={false}>
        <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
          <Tabs.List>
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

          {timeline.hasHistory && (
            <SegmentedControl
              size="xs"
              value={timelineMode}
              onChange={(v) => setTimelineMode(v as TimelineDisplayMode)}
              data={[
                { value: 'full', label: 'Весь срок' },
                { value: 'forecast', label: 'От сегодня' },
              ]}
            />
          )}
        </Group>

        <Tabs.Panel value="networth">
          <NetWorthTab points={points} timeline={timeline} />
        </Tabs.Panel>
        <Tabs.Panel value="balances">
          <BalancesTab points={points} timeline={timeline} />
        </Tabs.Panel>
        <Tabs.Panel value="sliprisk">
          <SlipRiskTab timeline={timeline} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  )
})
