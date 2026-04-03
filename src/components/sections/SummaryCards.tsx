import { memo } from 'react'
import {
  Paper,
  Text,
  Divider,
  SimpleGrid,
  Stack,
  Group,
  Badge,
  ThemeIcon,
  Alert,
} from '@mantine/core'
import { IconTrendingDown, IconTrendingUp, IconShield } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { formatRub, formatPct } from '../../lib/formatters'

interface MetricRowProps {
  label: string
  value: string
  valueColor?: string
}

function MetricRow({ label, value, valueColor }: MetricRowProps) {
  return (
    <Group justify="space-between" align="baseline">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600} style={{ color: valueColor }}>
        {value}
      </Text>
    </Group>
  )
}

export const SummaryCards = memo(function SummaryCards() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)

  const { summary, safetyPoint, minPayment } = result
  const winner = summary.winner

  const nwA = summary.A.netWorth
  const nwB = summary.B.netWorth
  const diff = Math.abs(nwA - nwB)

  const winnerBorderStyle = (strategy: 'A' | 'B') =>
    winner === strategy ? { border: '2px solid var(--mantine-color-green-6)' } : {}

  const investMonthly = Math.max(0, params.freeMonthly - minPayment)

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Text fw={600} size="lg">
        Сравнение на горизонте {params.horizonYears} лет
      </Text>
      <Divider mb="md" mt="xs" />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Strategy A card */}
        <Paper p="lg" shadow="sm" radius="md" style={winnerBorderStyle('A')}>
          <Group justify="space-between" align="flex-start" mb="xs">
            <Group gap="xs" align="flex-start">
              <ThemeIcon color="orange" variant="light" radius="xl" size="lg">
                <IconTrendingDown size={18} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text fw={700} size="lg">
                  Стратегия А
                </Text>
                <Text size="xs" c="dimmed">
                  Досрочное погашение
                </Text>
              </Stack>
            </Group>
            {winner === 'A' && (
              <Badge color="green" variant="filled" size="lg">
                Победитель ✓
              </Badge>
            )}
          </Group>

          <Text size="sm" c="dimmed" mb="md">
            Все свободные деньги идут на досрочное погашение с уменьшением ежемесячного платежа
          </Text>
          <Divider mb="md" />

          <Stack gap="sm">
            <MetricRow
              label="Чистое состояние"
              value={formatRub(nwA)}
              valueColor={
                nwA >= nwB
                  ? 'var(--mantine-color-green-7)'
                  : 'var(--mantine-color-red-6)'
              }
            />
            <MetricRow
              label="Остаток долга"
              value={formatRub(summary.A.debt)}
              valueColor="var(--mantine-color-red-6)"
            />
            <MetricRow
              label="Суммарно уплачено процентов"
              value={formatRub(summary.A.totalInterest)}
            />
            <MetricRow
              label="Итоговая переплата"
              value={formatRub(summary.A.totalPaid - (result.loanAmount - summary.A.debt))}
            />
            {result.tax && (
              <MetricRow
                label="Налоговые вычеты"
                value={formatRub(result.tax.deductionBuy + result.tax.deductionInterestTotal)}
                valueColor="var(--mantine-color-green-7)"
              />
            )}
          </Stack>

          {summary.A.debt === 0 && (
            <Alert color="green" variant="light" mt="sm" icon="✓">
              Долг полностью погашен в рамках горизонта!
            </Alert>
          )}
        </Paper>

        {/* Strategy B card */}
        <Paper p="lg" shadow="sm" radius="md" style={winnerBorderStyle('B')}>
          <Group justify="space-between" align="flex-start" mb="xs">
            <Group gap="xs" align="flex-start">
              <ThemeIcon color="blue" variant="light" radius="xl" size="lg">
                <IconTrendingUp size={18} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text fw={700} size="lg">
                  Стратегия Б
                </Text>
                <Text size="xs" c="dimmed">
                  Минимальный платёж + инвестиции
                </Text>
              </Stack>
            </Group>
            {winner === 'B' && (
              <Badge color="green" variant="filled" size="lg">
                Победитель ✓
              </Badge>
            )}
          </Group>

          <Text size="sm" c="dimmed" mb="md">
            Платим минимум {formatRub(minPayment)}/мес, остаток ({formatRub(investMonthly)}/мес)
            инвестируем под {formatPct(params.depositRate)} годовых
          </Text>
          <Divider mb="md" />

          <Stack gap="sm">
            <MetricRow
              label="Чистое состояние"
              value={formatRub(nwB)}
              valueColor={
                nwB >= nwA
                  ? 'var(--mantine-color-green-7)'
                  : 'var(--mantine-color-red-6)'
              }
            />
            <MetricRow
              label="Накопления"
              value={formatRub(summary.B.savings)}
              valueColor="var(--mantine-color-green-7)"
            />
            <MetricRow
              label="Остаток долга"
              value={formatRub(summary.B.debt)}
              valueColor="var(--mantine-color-red-6)"
            />
            <MetricRow
              label="Суммарно уплачено процентов"
              value={formatRub(summary.B.totalInterest)}
            />
            {result.tax && (
              <MetricRow
                label="Налоговые вычеты"
                value={formatRub(result.tax.deductionBuy + result.tax.deductionInterestTotal)}
                valueColor="var(--mantine-color-green-7)"
              />
            )}
          </Stack>

          {/* Safety point block */}
          <Paper
            bg={safetyPoint !== null ? 'green.0' : 'red.0'}
            p="sm"
            radius="sm"
            mt="sm"
          >
            <Group gap="xs">
              <ThemeIcon
                color={safetyPoint !== null ? 'green' : 'red'}
                variant="light"
                size="sm"
              >
                <IconShield size={12} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text
                  size="sm"
                  fw={600}
                  c={safetyPoint !== null ? 'green.8' : 'red.8'}
                >
                  Точка безопасности
                </Text>
                <Text size="xs" c="dimmed">
                  {safetyPoint !== null ? `Мес. ${safetyPoint + 1}` : 'Не достигнута'}
                </Text>
              </Stack>
            </Group>
          </Paper>
        </Paper>
      </SimpleGrid>

      {/* Winner delta */}
      <Paper bg="gray.0" p="md" radius="md" mt="md">
        <Stack gap={4} align="center">
          <Text size="sm" c="dimmed">
            Преимущество победителя на горизонте
          </Text>
          <Text
            size="xl"
            fw={700}
            c={diff > 0 ? 'green.7' : 'gray.5'}
          >
            +{formatRub(summary.winnerDelta)}
          </Text>
          <Text size="xs" c="dimmed">
            по показателю «чистое состояние»
          </Text>
        </Stack>
      </Paper>
    </Paper>
  )
})
