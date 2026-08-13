import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { InfoTooltip } from '../controls/InfoTooltip'
import { formatRub, formatPct, formatDate } from '../../lib/formatters'

const ASSUMPTIONS_TEXT =
  'Прошлое до «сегодня» восстановлено по корректировкам трекера; снимки остатка из банка ' +
  'считаются авторитетнее расчёта. Прогноз продолжает эту же ипотеку с сегодняшнего остатка, ' +
  'ставки и платежа.'

/**
 * Баннер режима ипотеки (§3.4 спеки docs/specs/2026-08-12-tracker-ux-design.md, обновлён
 * §8.4 спеки continuous-simulation-design). Рендерится в `CalculatorPage` над `ParamsSection`,
 * сам решает, показываться ли — когда `linkedMortgage === null` рендерит `null`.
 */
export function MortgageModeBanner() {
  const navigate = useNavigate()
  const linkedMortgage = useCalculatorStore((s) => s.linkedMortgage)
  const mortgageFact = useCalculatorStore((s) => s.mortgageFact)
  const factError = useCalculatorStore((s) => s.factError)
  const exitMortgageMode = useCalculatorStore((s) => s.exitMortgageMode)

  if (!linkedMortgage) return null

  // Факт ещё не загружен (страница только открылась, запрос в полёте) — баннер показывает
  // последние известные скаляры из персиста с бейджем «обновляем…», а не молчит (§8.4 спеки).
  const pending = mortgageFact === null && factError === null

  const color = linkedMortgage.termFallback ? 'yellow' : 'blue'
  // rate зафиксирован в момент входа в режим ипотеки (store.enterMortgageMode), а не
  // читается из params.itRate живьём — иначе сдвиг слайдера ставки в баннере "менял" бы
  // фактическую ставку по договору. В персисте до этого поля rate может быть undefined —
  // тогда строку ставки просто не показываем.
  const rateText = linkedMortgage.rate !== undefined ? ` · ставка ${formatPct(linkedMortgage.rate)}` : ''

  return (
    <Alert color={color} variant="light">
      <Stack gap={6}>
        <Group gap="xs" mb="xs" justify="space-between" wrap="wrap">
          <Group gap="xs" wrap="wrap" align="center">
            <Badge color={color}>Режим ипотеки</Badge>
            {pending && (
              <Badge color="gray" variant="light">
                обновляем…
              </Badge>
            )}
            <Text fw={600}>{linkedMortgage.title}</Text>
            <InfoTooltip text={ASSUMPTIONS_TEXT} />
          </Group>
        </Group>

        <Text size="sm">
          {`Остаток ${formatRub(linkedMortgage.balance)}${rateText} · платёж ` +
            `${formatRub(linkedMortgage.payment)}/мес · на ${formatDate(linkedMortgage.asOf)}`}
        </Text>

        {linkedMortgage.termFallback && (
          <Group gap={4} align="center" wrap="nowrap">
            <IconAlertTriangle size={16} color="var(--mantine-color-yellow-7)" />
            <Text size="sm">Текущий платёж не покрывает проценты, срок взят из договора</Text>
          </Group>
        )}

        <Group justify="flex-end" gap="xs">
          <Button variant="light" size="xs" onClick={() => navigate(`/tracker/${linkedMortgage.id}`)}>
            Открыть в трекере
          </Button>
          <Button variant="light" size="xs" color="gray" onClick={exitMortgageMode}>
            К моим параметрам
          </Button>
        </Group>
      </Stack>
    </Alert>
  )
}
