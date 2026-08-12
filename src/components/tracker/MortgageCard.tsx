import { Paper, Text, Group, Progress, Stack } from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import { computeMortgageState } from '../../lib/tracker'
import { formatRub, formatMonths, formatYearMonth } from '../../lib/formatters'
import type { MortgageDto } from '../../api/types'

interface MortgageCardProps {
  mortgage: MortgageDto
}

/**
 * Список ипотек отдаёт API без истории корректировок — карточка показывает
 * состояние по плановому графику (без событий), точное состояние — на странице ипотеки.
 */
export function MortgageCard({ mortgage }: MortgageCardProps) {
  const navigate = useNavigate()
  const state = computeMortgageState(mortgage, [], new Date())

  return (
    <Paper
      p="md"
      radius="md"
      shadow="sm"
      withBorder
      style={{ cursor: 'pointer' }}
      onClick={() => navigate(`/tracker/${mortgage.id}`)}
    >
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Text fw={600}>{mortgage.title}</Text>
          {mortgage.bank && (
            <Text size="xs" c="dimmed">
              {mortgage.bank}
            </Text>
          )}
        </Group>
        <Group gap="lg">
          <Text size="sm">
            Остаток: <b>{formatRub(state.currentBalance)}</b>
          </Text>
          <Text size="sm">
            Платёж: <b>{formatRub(state.currentPayment)}/мес</b>
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {state.monthsLeft !== null && state.payoffDate
            ? `Осталось ${formatMonths(state.monthsLeft)} до ${formatYearMonth(state.payoffDate)}`
            : 'Платёж не покрывает проценты — долг не убывает'}
        </Text>
        <Progress
          value={state.progressPct * 100}
          size="sm"
          color={state.progressPct >= 1 ? 'green' : 'blue'}
        />
      </Stack>
    </Paper>
  )
}
