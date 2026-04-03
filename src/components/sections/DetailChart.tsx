import { memo, useMemo } from 'react'
import { Paper, Text, Group, Box } from '@mantine/core'
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
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { formatRub, formatMonths } from '../../lib/formatters'
import type { MonthlyPoint } from '../../lib/engine'

interface TooltipPayloadItem {
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: number
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || label === undefined) return null

  return (
    <Paper shadow="sm" p="sm" radius="sm" style={{ minWidth: 220 }}>
      <Text size="xs" c="dimmed" mb={4}>
        Месяц {label} ({formatMonths(label)})
      </Text>
      {payload.map((item) => (
        <Text key={item.name} size="xs" style={{ color: item.color }}>
          {item.name}: {formatRub(item.value)}
        </Text>
      ))}
    </Paper>
  )
}

function formatYAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)} тыс`
  return String(v)
}

function xTickFormatter(v: number): string {
  return v % 12 === 0 ? `${v / 12}г.` : ''
}

export const DetailChart = memo(function DetailChart() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)

  const data = useMemo(
    () =>
      result.series.map((pt: MonthlyPoint) => ({
        month: pt.month,
        savingsB: pt.savingsB,
        debtB: pt.debtB,
        debtA: pt.debtA,
      })),
    [result.series],
  )

  const investMonthly = Math.max(0, params.freeMonthly - result.minPayment)

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Group justify="space-between" mb="md">
        <Text fw={600} size="md">
          Накопления и остаток долга
        </Text>
        <Text size="xs" c="dimmed">
          Динамика по месяцам
        </Text>
      </Group>

      {/* Легенда маркеров */}
      <Group gap="lg" mb="sm" wrap="wrap">
        {params.slipMonth > 0 && (
          <Group gap={6} align="center">
            <Box style={{ width: 20, height: 0, borderTop: '2px dashed #e03131' }} />
            <Text size="xs" c="dimmed">
              Месяц слёта с ИТ-ипотеки (мес. {params.slipMonth})
            </Text>
          </Group>
        )}
        {result.safetyPoint !== null && (
          <Group gap={6} align="center">
            <Box style={{ width: 20, height: 0, borderTop: '2px dashed #2f9e44' }} />
            <Text size="xs" c="dimmed">
              Точка финансовой безопасности (мес. {result.safetyPoint + 1})
            </Text>
          </Group>
        )}
      </Group>

      <Box style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis
              dataKey="month"
              tickFormatter={xTickFormatter}
              tick={{ fontSize: 12, fill: '#868e96' }}
            />
            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12, fill: '#868e96' }} width={65} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {params.slipMonth > 0 && (
              <ReferenceLine
                x={params.slipMonth}
                stroke="#e03131"
                strokeDasharray="6 3"
                strokeWidth={2}
                label={{ value: 'Слёт', fill: '#e03131', fontSize: 11, position: 'top' }}
              />
            )}
            {result.safetyPoint !== null && (
              <ReferenceLine
                x={result.safetyPoint + 1}
                stroke="#2f9e44"
                strokeDasharray="6 3"
                strokeWidth={2}
                label={{
                  value: 'Безопасность',
                  fill: '#2f9e44',
                  fontSize: 11,
                  position: 'top',
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="savingsB"
              stroke="#228be6"
              strokeWidth={2.5}
              dot={false}
              name="Накопления Б"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="debtB"
              stroke="#339af0"
              strokeWidth={2}
              strokeDasharray="8 4"
              dot={false}
              name="Долг Б"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="debtA"
              stroke="#f76707"
              strokeWidth={2}
              strokeDasharray="8 4"
              dot={false}
              name="Долг А"
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>

      <Text size="xs" c="dimmed" mt="xs">
        Накопления стратегии А не показаны (равны нулю). Инвестируемая сумма ежемесячно:{' '}
        {formatRub(investMonthly)}.
      </Text>
    </Paper>
  )
})
