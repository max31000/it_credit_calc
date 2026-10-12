import { Paper, Text, Group, Progress, Stack, Button, Tooltip } from '@mantine/core'
import { IconChartLine } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { computeMortgageState } from '../../lib/tracker'
import { mortgageToParams, accountSettingsFromParams } from '../../lib/mortgageToParams'
import { useCalculatorStore, linkFromMortgage } from '../../store/useCalculatorStore'
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
  const open = () => navigate(`/tracker/${mortgage.id}`)

  const handleOpenInCalculator = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (mortgageClosed) return
    const settings = accountSettingsFromParams(useCalculatorStore.getState().ownParams)
    const mapped = mortgageToParams({ mortgage, events, settings, today: new Date() })
    enterMortgageMode(linkFromMortgage(mortgage, mapped), mapped.params, mapped.fact)
    navigate('/')
  }

  return (
    <Paper
      p="md"
      className="cc-card-link"
      role="link"
      tabIndex={0}
      aria-label={`Ипотека «${mortgage.title}»`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) open()
      }}
    >
      <Stack gap="sm">
        <Stack gap={2}>
          <Text fw={600} lineClamp={1}>
            {mortgage.title}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {mortgage.bank ?? 'Банк не указан'}
          </Text>
        </Stack>
        <Group gap="lg" grow>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              Остаток
            </Text>
            <Text fw={600} className="mvv-num">
              {formatRub(state.currentBalance)}
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              Платёж
            </Text>
            <Text fw={600} className="mvv-num">
              {formatRub(state.currentPayment)}/мес
            </Text>
          </Stack>
        </Group>
        <Stack gap={6}>
          <Progress value={state.progressPct * 100} size="sm" aria-label="Погашено тела кредита" />
          <Text size="xs" c="dimmed">
            {state.monthsLeft !== null && state.payoffDate
              ? `Осталось ${formatMonths(state.monthsLeft)} — до ${formatYearMonth(state.payoffDate)}`
              : 'Платёж не покрывает проценты — долг не убывает'}
          </Text>
        </Stack>
        <Group justify="flex-end">
          <Tooltip label="Ипотека погашена — считать нечего" disabled={!mortgageClosed}>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconChartLine size={14} />}
              onClick={handleOpenInCalculator}
              aria-disabled={mortgageClosed}
              data-disabled={mortgageClosed || undefined}
            >
              Открыть в калькуляторе
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </Paper>
  )
}
