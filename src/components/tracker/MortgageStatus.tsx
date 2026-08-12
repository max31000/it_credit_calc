import { Paper, Progress, SimpleGrid, Stack, Text } from '@mantine/core'
import { MetricCard } from '../controls/MetricCard'
import { formatRub, formatPct, formatMonths, formatYearMonth } from '../../lib/formatters'
import type { MortgageState } from '../../lib/tracker'

interface MortgageStatusProps {
  state: MortgageState
}

export function MortgageStatus({ state }: MortgageStatusProps) {
  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Text fw={600} size="lg" mb="md">
        Текущее состояние
      </Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="lg">
        <MetricCard label="Остаток долга" value={formatRub(state.currentBalance)} color="blue" />
        <MetricCard label="Ставка" value={formatPct(state.currentRate)} color="orange" />
        <MetricCard label="Платёж" value={`${formatRub(state.currentPayment)}/мес`} />
        <MetricCard
          label="Осталось"
          value={state.monthsLeft !== null ? formatMonths(state.monthsLeft) : '—'}
          color={state.monthsLeft !== null ? 'green' : 'red'}
          description={
            state.payoffDate
              ? `закрытие к ${formatYearMonth(state.payoffDate)}`
              : 'платёж не покрывает проценты'
          }
        />
      </SimpleGrid>
      <Stack gap={4}>
        <Text size="sm">
          Погашено тела кредита: <b>{formatRub(state.paidPrincipal)}</b> (
          {(state.progressPct * 100).toFixed(1)}%)
        </Text>
        <Progress
          value={state.progressPct * 100}
          size="md"
          color={state.progressPct >= 1 ? 'green' : 'blue'}
        />
      </Stack>
    </Paper>
  )
}
