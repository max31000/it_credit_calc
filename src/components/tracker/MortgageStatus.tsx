import { Group, Progress, Stack, Text } from '@mantine/core'
import { Metric, MetricGrid, Section } from '@mvv42/kit'
import { formatRub, formatPct, formatMonths, formatYearMonth } from '../../lib/formatters'
import type { MortgageState } from '../../lib/tracker'

interface MortgageStatusProps {
  state: MortgageState
}

export function MortgageStatus({ state }: MortgageStatusProps) {
  const pct = state.progressPct * 100
  return (
    <>
      <MetricGrid cols={4} aria-label="Текущее состояние">
        <Metric label="Остаток долга" value={formatRub(state.currentBalance)} />
        <Metric label="Ставка" value={formatPct(state.currentRate)} />
        <Metric label="Платёж" value={formatRub(state.currentPayment)} hint="в месяц" />
        <Metric
          label="Осталось"
          value={state.monthsLeft !== null ? formatMonths(state.monthsLeft) : '—'}
          hint={
            state.payoffDate ? (
              `закрытие к ${formatYearMonth(state.payoffDate)}`
            ) : (
              <Text span inherit c="red">
                платёж не покрывает проценты
              </Text>
            )
          }
        />
      </MetricGrid>
      <Section title="Погашение тела кредита">
        <Stack gap={8}>
          <Group justify="space-between" gap="xs">
            <Text size="sm">
              Погашено <b className="mvv-num">{formatRub(state.paidPrincipal)}</b>
            </Text>
            <Text size="sm" c="dimmed" className="mvv-num">
              {pct.toFixed(1)}%
            </Text>
          </Group>
          <Progress value={pct} size="md" aria-label="Погашено тела кредита" />
        </Stack>
      </Section>
    </>
  )
}
