import { memo, useMemo, useState } from 'react'
import { Paper, Text, Tabs, Box, Stack, Group, SegmentedControl } from '@mantine/core'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts'
import { IconChartLine, IconWallet, IconAlertTriangle, IconCash } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { CHART_COLORS, formatYAxis, useChartTheme, xTickFormatter, yearTickFormatter } from '../charts/chartUtils'
import { ChartTooltip } from '../charts/ChartTooltip'
import { formatRub } from '../../lib/formatters'
import { buildTimeline, toAbsolute, sliceFromToday, type Timeline, type TimelinePoint } from '../../lib/timeline'
import { buildCashFlow, type YearKind } from '../../lib/reporting'

type TimelineDisplayMode = 'full' | 'forecast'
type CashFlowStrategy = 'prepay' | 'save'

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

/** Вертикаль «Сегодня» — общая для всех вкладок при наличии факта (§5.2 дизайна) */
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

/** Кастомная точка досрочного погашения на линии факта (§7.2 спеки continuous-simulation):
 *  нативный `<title>` даёт tooltip по наведению без завязки на recharts Tooltip payload,
 *  который для ReferenceDot не строится (это не точка ряда). */
function makePrepaymentDotShape(amount: number | null, yearMonth: string) {
  return function PrepaymentDotShape(props: { cx?: number; cy?: number }) {
    const { cx, cy } = props
    if (cx === undefined || cy === undefined) return <g />
    const [y, m] = yearMonth.split('-')
    const amountText = amount !== null ? formatRub(amount) : ''
    return (
      <circle cx={cx} cy={cy} r={5} fill={CHART_COLORS.payoff} stroke="var(--mantine-color-body)" strokeWidth={1.5}>
        <title>{`Досрочное погашение ${amountText} · ${m}.${y}`}</title>
      </circle>
    )
  }
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
        {timeline.hasFact &&
          ' До сегодня трекер знает только долг, поэтому серая линия — нижняя граница капитала. Ступенька на «Сегодня» — ваши текущие накопления.'}
      </Text>
      <ChartFrame data={data}>
        <Tooltip
          content={
            <ChartTooltip
              todayMonth={timeline.hasFact ? timeline.todayMonth : undefined}
              startedOn={timeline.startedOn}
            />
          }
        />
        <Legend />
        <ReferenceLine y={0} stroke={CHART_COLORS.neutral} strokeDasharray="4 4" strokeWidth={1} />
        {timeline.hasFact && <TodayReferenceLine month={timeline.todayMonth} />}
        {showSlip && (
          <ReferenceLine
            x={toAbsolute(timeline, effectiveSlipMonth)}
            stroke={CHART_COLORS.slip}
            strokeDasharray="6 3"
            strokeWidth={2}
            label={{ value: 'Слёт', fill: CHART_COLORS.slip, fontSize: 11, position: 'top' }}
          />
        )}
        {timeline.hasFact && (
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

  const prepaymentMarkers = useMemo(
    () => timeline.markers.filter((m) => m.kind === 'prepayment'),
    [timeline.markers],
  )
  const rateMarkers = useMemo(() => timeline.markers.filter((m) => m.kind === 'rate'), [timeline.markers])

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        Точка, где накопления пересекают долг, — момент, когда ипотеку можно закрыть целиком.
        {timeline.hasFact && prepaymentMarkers.length > 0 && ' Точки на линии факта — досрочные погашения.'}
      </Text>
      <ChartFrame data={data}>
        <Tooltip
          content={
            <ChartTooltip
              todayMonth={timeline.hasFact ? timeline.todayMonth : undefined}
              startedOn={timeline.startedOn}
            />
          }
        />
        <Legend />
        {timeline.hasFact && <TodayReferenceLine month={timeline.todayMonth} />}
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
        {rateMarkers.map((m) => (
          <ReferenceLine
            key={`rate-${m.month}`}
            x={m.month}
            ifOverflow="discard"
            stroke={CHART_COLORS.neutral}
            strokeDasharray="2 3"
            strokeWidth={1.5}
            label={{
              value: `ставка ${m.rate}%`,
              fill: CHART_COLORS.neutral,
              fontSize: 10,
              position: 'insideBottomLeft',
            }}
          />
        ))}
        {timeline.hasFact && (
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
        {prepaymentMarkers.map((m) => {
          const debtAtMarker = timeline.points[m.month]?.debtFact
          if (debtAtMarker === null || debtAtMarker === undefined) return null
          return (
            <ReferenceDot
              key={`prepay-${m.month}`}
              x={m.month}
              y={debtAtMarker}
              ifOverflow="discard"
              shape={makePrepaymentDotShape(m.amount, m.yearMonth)}
            />
          )
        })}
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

  const axisCaption = timeline.hasFact
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
              todayMonth={timeline.hasFact ? timeline.todayMonth : undefined}
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
        {timeline.hasFact && <TodayReferenceLine month={timeline.todayMonth} />}
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

/** Прозрачность бара «Движение денег» по типу года (§7.3 спеки): факт — насыщенный,
 *  прогноз — приглушённый, год стыка — промежуточный (в нём есть и то, и другое). */
function cashFlowOpacity(kind: YearKind): number {
  if (kind === 'forecast') return 0.45
  if (kind === 'mixed') return 0.75
  return 1
}

function CashFlowTab({ timeline }: { timeline: Timeline }) {
  const result = useCalculatorStore((s) => s.result)
  const fact = useCalculatorStore((s) => s.mortgageFact)
  const params = useCalculatorStore((s) => s.params)
  const [strategy, setStrategy] = useState<CashFlowStrategy>('save')
  const { gridColor, tickColor } = useChartTheme()

  const rows = useMemo(() => buildCashFlow(result, fact, strategy), [result, fact, strategy])
  const mixedYear = useMemo(() => rows.find((r) => r.kind === 'mixed')?.year ?? null, [rows])

  const horizonMonths = params.horizonYears * 12
  const remainingMonths = fact?.engine.remainingMonths ?? null
  const showTermEndCaption = remainingMonths !== null && horizonMonths > remainingMonths

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="wrap" gap="sm" align="flex-start">
        <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 260 }}>
          {timeline.hasFact
            ? 'Слева от «Сегодня» — фактически внесённые деньги по данным трекера, справа — прогноз выбранного подхода. Год стыка содержит и то, и другое.'
            : 'Движение денег по годам прогноза: проценты, тело кредита и досрочные погашения.'}
        </Text>
        <SegmentedControl
          size="xs"
          value={strategy}
          onChange={(v) => setStrategy(v as CashFlowStrategy)}
          data={[
            { value: 'save', label: 'Копить' },
            { value: 'prepay', label: 'Гасить досрочно' },
          ]}
        />
      </Group>
      {showTermEndCaption && (
        <Text size="xs" c="dimmed">
          Срок ипотеки заканчивается на {timeline.todayMonth + (remainingMonths as number)}-м месяце — дальше
          сравниваются только накопления.
        </Text>
      )}
      <Box style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 24, right: 24, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="year" tickFormatter={yearTickFormatter} tick={{ fontSize: 12, fill: tickColor }} />
            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12, fill: tickColor }} width={65} />
            <Tooltip content={<ChartTooltip mode="year" labelPrefix="Год" />} />
            <Legend />
            <Bar dataKey="interest" stackId="a" name="Проценты" fill={CHART_COLORS.danger} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={`interest-${row.year}`} fillOpacity={cashFlowOpacity(row.kind)} />
              ))}
            </Bar>
            <Bar dataKey="principal" stackId="a" name="Тело" fill={CHART_COLORS.save} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={`principal-${row.year}`} fillOpacity={cashFlowOpacity(row.kind)} />
              ))}
            </Bar>
            <Bar
              dataKey="prepayment"
              stackId="a"
              name="Досрочки"
              fill={CHART_COLORS.payoff}
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell key={`prepayment-${row.year}`} fillOpacity={cashFlowOpacity(row.kind)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
      {mixedYear !== null && (
        <Text size="xs" c="dimmed">
          Год стыка ({yearTickFormatter(mixedYear)}) — частично прогноз.
        </Text>
      )}
    </Stack>
  )
}

export const ChartsSection = memo(function ChartsSection() {
  const result = useCalculatorStore((s) => s.result)
  const fact = useCalculatorStore((s) => s.mortgageFact)
  const [timelineMode, setTimelineMode] = useState<TimelineDisplayMode>('full')

  // Единый пересчёт «факт + прогноз» на весь блок графиков (§2.3 спеки continuous-simulation) —
  // раздаётся во вкладки пропсами вместо трёх отдельных useMemo, как было раньше.
  const timeline = useMemo(() => buildTimeline(result, fact), [result, fact])

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
            <Tabs.Tab value="cashflow" leftSection={<IconCash size={16} />}>
              Движение денег
            </Tabs.Tab>
            <Tabs.Tab value="sliprisk" leftSection={<IconAlertTriangle size={16} />}>
              Риск слёта
            </Tabs.Tab>
          </Tabs.List>

          {timeline.hasFact && (
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
        <Tabs.Panel value="cashflow">
          <CashFlowTab timeline={timeline} />
        </Tabs.Panel>
        <Tabs.Panel value="sliprisk">
          <SlipRiskTab timeline={timeline} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  )
})
