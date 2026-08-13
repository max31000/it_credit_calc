import type { ReactNode } from 'react'
import { Stack, Text, Group, Table, Button, Alert } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { formatRub, formatPct, formatMonths, formatMonthsAgo, formatYearMonth } from '../../lib/formatters'
import type { MortgageFact } from '../../lib/tracker'

interface MortgageFactsCardProps {
  fact: MortgageFact
}

/**
 * Read-only карточка фактов по ипотеке (§8.2 спеки continuous-simulation-design). Заменяет
 * левую колонку слайдеров `ParamsSection` в режиме ипотеки: цена, взнос, сумма кредита, ставка
 * и срок — реальные факты по договору, их нельзя «подвигать» из калькулятора. Редактирование —
 * только в трекере (кнопка ниже).
 */
export function MortgageFactsCard({ fact }: MortgageFactsCardProps) {
  const navigate = useNavigate()
  const linkedMortgage = useCalculatorStore((s) => s.linkedMortgage)
  const exitMortgageMode = useCalculatorStore((s) => s.exitMortgageMode)

  const downPaymentPct = fact.propertyPrice > 0 ? (fact.downPayment / fact.propertyPrice) * 100 : 0
  const rateChanged = Math.abs(fact.engine.rate - fact.originalRate) > 1e-9

  const rows: Array<[string, ReactNode]> = [
    ['Стоимость квартиры', formatRub(fact.propertyPrice)],
    ['Первоначальный взнос', `${formatRub(fact.downPayment)} (${downPaymentPct.toFixed(1)}%)`],
    ['Сумма кредита при выдаче', formatRub(fact.principal)],
    ['Дата выдачи', `${formatYearMonth(fact.startedOn.slice(0, 7))} · ${formatMonthsAgo(fact.elapsedMonths)}`],
    [
      'Ставка при выдаче → сейчас',
      rateChanged ? `${formatPct(fact.originalRate)} → ${formatPct(fact.engine.rate)}` : formatPct(fact.engine.rate),
    ],
    ['Срок по договору', `${fact.termMonths} мес., осталось ${formatMonths(fact.engine.remainingMonths)}`],
    ['Остаток долга', formatRub(fact.engine.debt)],
    ['Обязательный платёж', `${formatRub(fact.engine.payment)}/мес`],
  ]

  return (
    <Stack gap="md">
      <Table withRowBorders={false} verticalSpacing={4} horizontalSpacing={4}>
        <Table.Tbody>
          {rows.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {label}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={500} ta="right">
                  {value}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {fact.termExpired && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          Срок по договору истёк, а долг остался — остаток срока оценён по текущим ставке и платежу.
        </Alert>
      )}
      {!fact.paymentCoversInterest && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          Текущий платёж не покрывает проценты — долг растёт.
        </Alert>
      )}

      <Group gap="xs">
        {linkedMortgage && (
          <Button variant="light" size="xs" onClick={() => navigate(`/tracker/${linkedMortgage.id}`)}>
            Изменить в трекере
          </Button>
        )}
        <Button variant="subtle" size="xs" color="gray" onClick={exitMortgageMode}>
          К моим параметрам
        </Button>
      </Group>
    </Stack>
  )
}
