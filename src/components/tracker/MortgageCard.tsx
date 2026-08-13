import { Paper, Text, Group, Progress, Stack, Button, Tooltip } from '@mantine/core'
import { IconChartLine } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { computeMortgageState } from '../../lib/tracker'
import { mortgageToParams, accountSettingsFromParams } from '../../lib/mortgageToParams'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { formatRub, formatMonths, formatYearMonth } from '../../lib/formatters'
import type { MortgageDto, MortgageEventDto } from '../../api/types'

interface MortgageCardProps {
  mortgage: MortgageDto
  events: MortgageEventDto[]
}

export function MortgageCard({ mortgage, events }: MortgageCardProps) {
  const navigate = useNavigate()
  const enterMortgageMode = useCalculatorStore((s) => s.enterMortgageMode)
  const state = computeMortgageState(mortgage, events, new Date())
  const mortgageClosed = state.currentBalance === 0

  const handleOpenInCalculator = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (mortgageClosed) return
    const settings = accountSettingsFromParams(useCalculatorStore.getState().ownParams)
    const { params, state: mState, termFallback } = mortgageToParams({
      mortgage,
      events,
      settings,
      today: new Date(),
    })
    enterMortgageMode(
      {
        id: mortgage.id,
        title: mortgage.title,
        asOf: mState.asOf,
        balance: mState.currentBalance,
        payment: mState.currentPayment,
        termFallback,
      },
      params,
    )
    navigate('/')
  }

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
        <Group justify="flex-end">
          <Tooltip label="Ипотека погашена — считать нечего" disabled={!mortgageClosed}>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconChartLine size={14} />}
              onClick={handleOpenInCalculator}
              aria-disabled={mortgageClosed}
              style={mortgageClosed ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              Открыть в калькуляторе
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </Paper>
  )
}
