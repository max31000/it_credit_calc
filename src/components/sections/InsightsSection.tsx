import { memo, useMemo, type ReactNode } from 'react'
import {
  Paper,
  Text,
  Divider,
  SimpleGrid,
  Stack,
  Group,
  ThemeIcon,
  Accordion,
  Table,
  Badge,
} from '@mantine/core'
import {
  IconCoin,
  IconShieldCheck,
  IconShieldOff,
  IconScale,
  IconTrendingUp,
  IconFlagCheck,
  IconAlertTriangle,
  IconArrowDown,
  IconHistory,
  IconReceipt,
} from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { MetricCard } from '../controls/MetricCard'
import { formatRub, formatMonths } from '../../lib/formatters'
import { buildDeductionReport, type DeductionStatus } from '../../lib/reporting'

interface InsightCardProps {
  icon: ReactNode
  color: string
  title: string
  children: ReactNode
}

function InsightCard({ icon, color, title, children }: InsightCardProps) {
  return (
    <Paper
      p="md"
      radius="md"
      withBorder
      style={{ borderLeft: `4px solid var(--mantine-color-${color}-6)` }}
    >
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <ThemeIcon color={color} variant="light" size="lg" radius="xl">
          {icon}
        </ThemeIcon>
        <Stack gap={4} style={{ flex: 1 }}>
          <Text fw={600} size="sm">
            {title}
          </Text>
          <Text size="sm">{children}</Text>
        </Stack>
      </Group>
    </Paper>
  )
}

const DEDUCTION_STATUS_LABEL: Record<DeductionStatus, string> = {
  claimed: 'заявлен',
  partial: 'заявлен частично',
  forecast: 'к возврату',
  noBase: 'нет базы',
}

export const InsightsSection = memo(function InsightsSection() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())
  const fact = useCalculatorStore((s) => s.mortgageFact)

  const { summary, slip, payoffMonth, safetyMonth, minPayment } = result
  const hasLoan = result.loanAmount > 0
  const budgetTooSmall = hasLoan && params.freeMonthly <= minPayment
  const horizonLabel = `${params.horizonYears} лет`

  // Режим ипотеки: все горизонтные величины по-прежнему считаются «от сегодня», абсолютный
  // месяц ипотеки идёт справочно в скобках (§2.3 спеки continuous-simulation).
  const hasFact = fact !== null
  const todayMonth = hasFact ? fact.elapsedMonths : 0

  const deductionReport = useMemo(
    () => (params.salary !== null ? buildDeductionReport(result, fact, params) : null),
    [result, fact, params],
  )

  if (!hasLoan) {
    return null
  }

  const advantage = summary.advantageSave
  const advantageAbs = Math.abs(advantage)

  // «Переплата по графику» (§5, §5.1 спеки continuous-simulation): без факта — прежняя формула
  // (пересчитанный аннуитет нового кредита); с фактом — факт + остаток по текущему графику,
  // а если текущий платёж не покрывает проценты, переплата по графику не определена вовсе.
  const overpayLabel = 'Переплата по графику за весь срок'
  let overpayValue: string
  let overpayDescription: string
  if (fact && !fact.paymentCoversInterest) {
    overpayValue = formatRub(fact.engine.paidInterest)
    overpayDescription = 'платёж не покрывает проценты — переплата не определена'
  } else if (fact) {
    const aheadInterest = Math.max(0, result.totalInterest - fact.engine.paidInterest)
    overpayValue = formatRub(result.totalInterest)
    overpayDescription = `уже уплачено ${formatRub(fact.engine.paidInterest)} · впереди ${formatRub(aheadInterest)}`
  } else {
    overpayValue = formatRub(result.totalInterest)
    overpayDescription = 'без досрочки и слёта'
  }

  const prepaymentsCount = fact ? fact.events.filter((e) => e.kind === 'prepayment').length : 0

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Text fw={600} size="lg">
        Выводы на горизонте {horizonLabel}
        {hasFact && ' — считаем от сегодня'}
      </Text>
      <Divider mb="md" mt="xs" />

      {/* Ключевые числа */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="md">
        <MetricCard
          label="Обязательный платёж"
          value={`${formatRub(minPayment)}/мес`}
          color="blue"
          // В режиме ипотеки это фактический платёж по договору (`fact.payment`), а не
          // рассчитанный льготный аннуитет — ставка могла уже смениться rate-событием.
          description={hasFact ? 'по договору, факт' : 'льготный аннуитет'}
        />
        <MetricCard label={overpayLabel} value={overpayValue} color="red" description={overpayDescription} />
        <MetricCard
          label="Доход от инвестиций"
          value={formatRub(summary.save.investmentIncome)}
          color="green"
          description="если копить, за горизонт"
        />
        <MetricCard
          label="Налоговые вычеты"
          value={
            result.tax
              ? formatRub(result.tax.propertyReturnTotal + result.tax.interestReturnTotal)
              : '—'
          }
          color={result.tax ? 'green' : 'gray'}
          description={result.tax ? 'за горизонт' : 'укажите зарплату'}
        />
      </SimpleGrid>

      {/* Уплачено банку с выдачи ипотеки (§3.4, §5 спеки): факт + прогноз; без факта совпадает
          с прежними totalPaid/totalInterest — карточка честна и для гостя. */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="lg">
        <MetricCard
          label="Уплачено банку с начала ипотеки"
          value={formatRub(summary.save.totalPaidWithFact)}
          color="default"
          description={hasFact ? 'факт + прогноз, с выдачи' : 'за горизонт'}
        />
        <MetricCard
          label="Из них процентов"
          value={formatRub(summary.save.totalInterestWithFact)}
          color="default"
          description={hasFact ? 'факт + прогноз, с выдачи' : 'за горизонт'}
        />
      </SimpleGrid>

      {result.tax && (
        <Text size="xs" c="dimmed" mb="sm">
          Доступная база: имущественный {formatRub(result.tax.propertyBaseStart)}
          {result.tax.propertyBaseStart <= 0 && ' (исчерпан — в прогнозе не начисляется)'}, проценты{' '}
          {formatRub(result.tax.interestBaseStart)}
          {result.tax.interestBaseStart <= 0 && ' (исчерпан — в прогнозе не начисляется)'}
        </Text>
      )}

      {/* Таблица вычетов по годам (§6.2 спеки continuous-simulation): прошлые годы — факт
          с статусом по израсходованной базе, год стыка — «частично факт», будущее — прогноз. */}
      {deductionReport && deductionReport.rows.length > 0 && (
        <Accordion variant="separated" mb="lg">
          <Accordion.Item value="deductions">
            <Accordion.Control>
              <Group gap="xs">
                <ThemeIcon color="orange" variant="light" size="sm">
                  <IconReceipt size={14} />
                </ThemeIcon>
                <Text fw={600} size="sm">
                  Таблица вычетов по годам
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Table striped style={{ fontSize: 12 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Год</Table.Th>
                    <Table.Th>Проценты за год</Table.Th>
                    <Table.Th>Что с вычетом</Table.Th>
                    <Table.Th>Возврат</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {deductionReport.rows.map((row) => (
                    <Table.Tr key={row.year} style={row.kind === 'fact' ? { opacity: 0.65 } : undefined}>
                      <Table.Td>
                        {row.year}
                        {row.kind === 'mixed' && (
                          <Badge size="xs" ml={6} color="orange" variant="light">
                            частично факт
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>{formatRub(row.interestPaid)}</Table.Td>
                      <Table.Td>{DEDUCTION_STATUS_LABEL[row.status]}</Table.Td>
                      <Table.Td>{formatRub(row.refund)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      <Stack gap="sm">
        {fact && !fact.paymentCoversInterest && (
          <InsightCard
            icon={<IconAlertTriangle size={18} />}
            color="red"
            title="Текущий платёж не покрывает проценты"
          >
            Обязательный платёж ({formatRub(fact.engine.payment)}/мес) меньше начисленных процентов —
            долг по этой ипотеке растёт. Переплата по графику в этом случае не определена: нужен
            платёж выше или досрочные погашения.
          </InsightCard>
        )}

        {budgetTooSmall && (
          <InsightCard
            icon={<IconAlertTriangle size={18} />}
            color="yellow"
            title="Бюджета хватает только на обязательный платёж"
          >
            Свободных денег сверх платежа нет, поэтому досрочка и накопления недоступны — все
            выводы ниже совпадают для обоих подходов. Сравнение становится осмысленным при бюджете
            выше {formatRub(minPayment)}/мес.
          </InsightCard>
        )}

        {/* Сравнение подходов */}
        {!budgetTooSmall && (
          <InsightCard
            icon={<IconScale size={18} />}
            color={advantage >= 0 ? 'blue' : 'orange'}
            title="Гасить досрочно или копить?"
          >
            Если весь бюджет направлять в досрочное погашение, к горизонту ваш капитал составит{' '}
            <b>{formatRub(summary.prepay.netWorth)}</b>. Если платить минимум и копить —{' '}
            <b>{formatRub(summary.save.netWorth)}</b>.{' '}
            {advantageAbs < 50_000 ? (
              <>Разница незначительна — подходы практически эквивалентны.</>
            ) : (
              <>
                Разница <b>{formatRub(advantageAbs)}</b> в пользу{' '}
                {advantage > 0 ? 'накоплений' : 'досрочного погашения'}
                {slip && ' (с учётом заданного слёта)'}.
              </>
            )}
          </InsightCard>
        )}

        {/* Точка полного погашения */}
        {!budgetTooSmall && (
          <InsightCard
            icon={<IconFlagCheck size={18} />}
            color="green"
            title="Когда накоплений хватит, чтобы закрыть ипотеку целиком"
          >
            {payoffMonth === 0 ? (
              <>
                Накоплений (<b>{formatRub(params.startingSavings)}</b>) уже сейчас хватает, чтобы
                закрыть остаток долга (<b>{formatRub(result.loanAmount)}</b>) одним платежом.
              </>
            ) : payoffMonth !== null ? (
              <>
                Через <b>{formatMonths(payoffMonth)}</b> (без слёта
                {hasFact && `, ${todayMonth + payoffMonth}-й месяц ипотеки`}) накопления
                сравняются с остатком долга — с этого момента ипотеку можно погасить одним
                платежом в любой день.
              </>
            ) : (
              <>
                За {horizonLabel} накопления не успевают догнать остаток долга. Увеличьте горизонт
                сравнения или ежемесячный бюджет.
              </>
            )}
          </InsightCard>
        )}

        {/* Доход от инвестиций */}
        {!budgetTooSmall && summary.save.investmentIncome > 0 && (
          <InsightCard
            icon={<IconTrendingUp size={18} />}
            color="teal"
            title="Что заработают накопления"
          >
            Если платить минимальный платёж и копить под {params.depositRate.toFixed(1)}% годовых,
            проценты принесут <b>{formatRub(summary.save.investmentIncome)}</b> за {horizonLabel}
            {result.tax && (
              <>
                , плюс налоговые вычеты{' '}
                <b>{formatRub(result.tax.propertyReturnTotal + result.tax.interestReturnTotal)}</b>
              </>
            )}
            .
          </InsightCard>
        )}

        {/* Слёт */}
        {slip && (
          <>
            <InsightCard
              icon={<IconCoin size={18} />}
              color="red"
              title={
                hasFact
                  ? `Сколько стоит слёт через ${formatMonths(effectiveSlipMonth)} (${todayMonth + effectiveSlipMonth}-й месяц ипотеки)`
                  : `Сколько стоит слёт в месяц ${effectiveSlipMonth}`
              }
            >
              Потеря льготы обойдётся в <b>{formatRub(slip.slipLoss)}</b> к горизонту: столько
              капитала съест рыночная ставка {slip.marketRate.toFixed(1)}% по сравнению со
              сценарием без слёта.
            </InsightCard>

            <InsightCard
              icon={<IconArrowDown size={18} />}
              color={slip.dumpBenefit >= 0 ? 'blue' : 'orange'}
              title="Что делать с накоплениями при слёте"
            >
              Если в момент слёта внести все накопления ({formatRub(slip.savingsAtSlip)}) в долг,
              платёж составит <b>{formatRub(slip.paymentWithPrepay)}/мес</b> вместо{' '}
              <b>{formatRub(slip.paymentWithoutPrepay)}/мес</b>.{' '}
              {slip.dumpBenefit >= 0 ? (
                <>
                  К горизонту это выгоднее на <b>{formatRub(slip.dumpBenefit)}</b>, чем оставить
                  деньги на вкладе.
                </>
              ) : (
                <>
                  Но при доходности вклада {params.depositRate.toFixed(1)}% выше рыночной ставки
                  выгоднее <b>не вносить</b>: держать деньги на вкладе принесёт на{' '}
                  <b>{formatRub(Math.abs(slip.dumpBenefit))}</b> больше к горизонту.
                </>
              )}
            </InsightCard>
          </>
        )}

        {/* Точка безопасности */}
        {!budgetTooSmall &&
          (safetyMonth !== null ? (
            <InsightCard
              icon={<IconShieldCheck size={18} />}
              color="green"
              title="Когда слёт перестанет быть страшным"
            >
              {hasFact ? (
                <>
                  Через <b>{formatMonths(safetyMonth)}</b> ({safetyMonth}-й месяц от сегодня,{' '}
                  {todayMonth + safetyMonth}-й месяц ипотеки) накоплений достаточно, чтобы при
                  слёте — после внесения их в долг — платёж не превысил льготный уровень{' '}
                  {formatRub(minPayment)}/мес.
                </>
              ) : (
                <>
                  Начиная с <b>месяца {safetyMonth}</b> (через {formatMonths(safetyMonth)})
                  накоплений достаточно, чтобы при слёте — после внесения их в долг — платёж не
                  превысил льготный уровень {formatRub(minPayment)}/мес.
                </>
              )}
            </InsightCard>
          ) : (
            <InsightCard
              icon={<IconShieldOff size={18} />}
              color="red"
              title="Точка безопасности не достигается"
            >
              За {horizonLabel} накоплений не хватит, чтобы при слёте удержать платёж на льготном
              уровне. Снизить риск можно бόльшим бюджетом в месяц или бόльшим первоначальным
              взносом.
            </InsightCard>
          ))}

        {/* Что уже произошло — только в режиме ипотеки с фактом (§5 спеки continuous-simulation) */}
        {fact && (
          <InsightCard icon={<IconHistory size={18} />} color="grape" title="Что уже произошло">
            За {formatMonths(fact.elapsedMonths)} по этой ипотеке внесено банку{' '}
            <b>{formatRub(fact.history.paidTotal)}</b>: из них{' '}
            <b>{formatRub(fact.history.paidInterest)}</b> процентов и{' '}
            <b>{formatRub(fact.history.principalRepaid)}</b> тела.
            {prepaymentsCount > 0 && (
              <>
                {' '}
                Досрочных погашений — <b>{prepaymentsCount}</b> на{' '}
                <b>{formatRub(fact.history.paidPrepayments)}</b>.
              </>
            )}{' '}
            Остаток долга <b>{formatRub(fact.engine.debt)}</b> из исходных{' '}
            <b>{formatRub(fact.principal)}</b>.
            {Math.abs(fact.history.snapshotDrift) > 1000 && (
              <>
                {' '}
                Остаток по выпискам банка расходится с расчётом на{' '}
                <b>{formatRub(Math.abs(fact.history.snapshotDrift))}</b> — учтено по выпискам.
              </>
            )}
          </InsightCard>
        )}
      </Stack>
    </Paper>
  )
})
