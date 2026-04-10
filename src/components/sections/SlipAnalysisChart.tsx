import { memo, useMemo } from 'react'
import { Paper, Text, Stack, Box, Alert, Group, ThemeIcon, useComputedColorScheme } from '@mantine/core'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { IconShieldCheck, IconAlertCircle } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { formatRub, formatMonths } from '../../lib/formatters'
import type { SlipPoint } from '../../lib/engine'

interface CustomTooltipProps {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: ReadonlyArray<any>
  label?: string | number
  minPayment: number
}

function CustomTooltip({ active, payload, label, minPayment }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || label === undefined) return null
  const labelNum = typeof label === 'string' ? parseFloat(label) : label

  return (
    <Paper shadow="sm" p="sm" radius="sm" style={{ minWidth: 240 }}>
      <Text size="xs" c="dimmed" mb={4}>
        Если слёт в мес. {labelNum}:
      </Text>
      {payload.map((item: { name: string; value: number; color: string }) => (
        <Text key={item.name} size="xs" style={{ color: item.color }}>
          {item.name}: {formatRub(item.value)}
        </Text>
      ))}
      <Text size="xs" c="green.7" mt={4}>
        Льготный PMT: {formatRub(minPayment)}
      </Text>
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

export const SlipAnalysisChart = memo(function SlipAnalysisChart() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const isDark = useComputedColorScheme('light') === 'dark'
  const gridColor = isDark ? '#373A40' : '#e9ecef'
  const tickColor = isDark ? '#909296' : '#868e96'

  const data = useMemo(
    () =>
      result.slipAnalysis.map((pt: SlipPoint) => ({
        month: pt.slipMonth,
        paymentWithoutPrepay: pt.paymentWithoutPrepay,
        paymentWithPrepay: pt.paymentWithPrepay,
      })),
    [result.slipAnalysis],
  )

  const safetyPoint = result.safetyPoint
  // safetyPoint is 0-based index in slipAnalysis; slipAnalysis[i].slipMonth = i+1
  const safetyMonth = safetyPoint !== null ? result.slipAnalysis[safetyPoint]?.slipMonth ?? null : null

  const safetyAnnotation =
    safetyMonth !== null && safetyPoint !== null ? (
      <Paper p="sm" radius="sm" mt="xs" style={{ backgroundColor: 'var(--mantine-color-green-light)' }}>
        <Group gap="xs" align="flex-start">
          <ThemeIcon color="green" variant="light" size="sm">
            <IconShieldCheck size={12} />
          </ThemeIcon>
          <Text size="sm">
            Начиная с месяца {safetyMonth} (через {formatMonths(safetyMonth)}), даже при слёте с
            ИТ-ипотеки ваш платёж (
            {formatRub(result.slipAnalysis[safetyPoint]?.paymentWithPrepay ?? 0)} ₽) не превысит
            льготный уровень {formatRub(result.minPayment)}.
          </Text>
        </Group>
      </Paper>
    ) : (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} mt="xs">
        На выбранном горизонте точка безопасности не достигается. Рассмотрите увеличение свободных
        средств или горизонта сравнения.
      </Alert>
    )

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Stack gap={4} mb="md">
        <Text fw={600} size="md">
          Анализ платежа при слёте: безопасный период
        </Text>
        <Text size="xs" c="dimmed">
          Ось X — не время, а момент возможного слёта. Показывает, какой платёж был бы при слёте в
          каждый конкретный месяц.
        </Text>
      </Stack>

      {/* Подписи осей */}
      <Group justify="space-between" mb={4}>
        <Text size="xs" c="dimmed">↑ Платёж после слёта, ₽</Text>
        <Text size="xs" c="dimmed">Месяц возможного слёта →</Text>
      </Group>

      {/* Легенда маркеров */}
      <Group gap="lg" mb="sm" wrap="wrap">
        {params.slipMonth > 0 && (
          <Group gap={6} align="center">
            <Box style={{ width: 20, height: 0, borderTop: '2px dashed #adb5bd' }} />
            <Text size="xs" c="dimmed">Текущий выбранный момент слёта</Text>
          </Group>
        )}
        {result.safetyPoint !== null && (
          <Group gap={6} align="center">
            <Box style={{ width: 20, height: 0, borderTop: '2px solid #7950f2' }} />
            <Text size="xs" c="dimmed">
              Точка безопасности — с этого момента платёж при слёте ≤ льготному PMT
            </Text>
          </Group>
        )}
        <Group gap={6} align="center">
          <Box style={{ width: 20, height: 0, borderTop: '2px solid #2f9e44' }} />
          <Text size="xs" c="dimmed">Льготный платёж (безопасный порог)</Text>
        </Group>
      </Group>

      <Box style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="month"
              tickFormatter={xTickFormatter}
              tick={{ fontSize: 12, fill: tickColor }}
            />
            <YAxis
              tickFormatter={formatYAxis}
              tick={{ fontSize: 12, fill: tickColor }}
              width={65}
            />
            <Tooltip
              content={(props) => (
                <CustomTooltip {...props} minPayment={result.minPayment} />
              )}
            />
            <Legend />
            <ReferenceLine
              y={result.minPayment}
              stroke="#2f9e44"
              strokeWidth={2}
              label={{ value: 'Льготный PMT', fill: '#2f9e44', fontSize: 11, position: 'insideTopLeft' }}
            />
            {safetyMonth !== null && (
              <ReferenceLine
                x={safetyMonth}
                stroke="#7950f2"
                strokeWidth={2}
                label={{ value: 'Точка безопасности', fill: '#7950f2', fontSize: 11, position: 'top' }}
              />
            )}
            {params.slipMonth > 0 && (
              <ReferenceLine
                x={params.slipMonth}
                stroke="#adb5bd"
                strokeDasharray="6 3"
                label={{ value: 'Текущий слёт', fill: '#adb5bd', fontSize: 11, position: 'top' }}
              />
            )}
            <Line
              type="monotone"
              dataKey="paymentWithoutPrepay"
              stroke="#fa5252"
              strokeWidth={2.5}
              dot={false}
              name="Без досрочного погашения"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="paymentWithPrepay"
              stroke="#228be6"
              strokeWidth={2.5}
              dot={false}
              name="Со стратегией досрочного погашения"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>

      {safetyAnnotation}
    </Paper>
  )
})
