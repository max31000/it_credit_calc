import { memo, useMemo } from 'react'
import { Paper, Text, Group, Box, useComputedColorScheme } from '@mantine/core'
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

export const NetWorthChart = memo(function NetWorthChart() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const isDark = useComputedColorScheme('light') === 'dark'
  const gridColor = isDark ? '#373A40' : '#e9ecef'
  const tickColor = isDark ? '#909296' : '#868e96'

  const data = useMemo(
    () =>
      result.series.map((pt: MonthlyPoint) => ({
        month: pt.month,
        netWorthA: pt.netWorthA,
        netWorthB: pt.netWorthB,
      })),
    [result.series],
  )

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Group justify="space-between" mb="md">
        <Text fw={600} size="md">
          Чистое состояние по месяцам
        </Text>
        <Text size="xs" c="dimmed">
          netWorth = накопления − долг
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
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="month"
              tickFormatter={xTickFormatter}
              tick={{ fontSize: 12, fill: tickColor }}
            />
            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 12, fill: tickColor }} width={65} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <ReferenceLine y={0} stroke="#868e96" strokeDasharray="4 4" strokeWidth={1} />
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
              dataKey="netWorthA"
              stroke="#f76707"
              strokeWidth={2.5}
              dot={false}
              name="Стратегия А: досрочное погашение"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="netWorthB"
              stroke="#228be6"
              strokeWidth={2.5}
              dot={false}
              name="Стратегия Б: инвестиции"
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  )
})
