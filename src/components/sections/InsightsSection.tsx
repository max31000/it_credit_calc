import { memo, type ReactNode } from 'react'
import { Paper, Text, Divider, SimpleGrid, Stack, Group, ThemeIcon } from '@mantine/core'
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
} from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { MetricCard } from '../controls/MetricCard'
import { formatRub, formatMonths } from '../../lib/formatters'

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

export const InsightsSection = memo(function InsightsSection() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const effectiveSlipMonth = useCalculatorStore((s) => s.effectiveSlipMonth())
  const linkedMortgage = useCalculatorStore((s) => s.linkedMortgage)

  const { summary, slip, payoffMonth, safetyMonth, minPayment } = result
  const hasLoan = result.loanAmount > 0
  const budgetTooSmall = hasLoan && params.freeMonthly <= minPayment
  const horizonLabel = `${params.horizonYears} лет`

  // Режим ипотеки: все горизонтные величины по-прежнему считаются «от сегодня», абсолютный
  // месяц ипотеки идёт справочно в скобках (§6 дизайна таймлайна).
  const history = linkedMortgage?.history
  const hasHistory = !!history && history.length > 0
  const todayMonth = hasHistory ? history!.length - 1 : 0

  if (!hasLoan) {
    return null
  }

  const advantage = summary.advantageSave
  const advantageAbs = Math.abs(advantage)

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Text fw={600} size="lg">
        Выводы на горизонте {horizonLabel}
        {hasHistory && ' — считаем от сегодня'}
      </Text>
      <Divider mb="md" mt="xs" />

      {/* Ключевые числа */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="lg">
        <MetricCard
          label="Обязательный платёж"
          value={`${formatRub(minPayment)}/мес`}
          color="blue"
          description="льготный аннуитет"
        />
        <MetricCard
          label="Переплата по графику"
          value={formatRub(result.totalInterest)}
          color="red"
          description="без досрочки и слёта"
        />
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

      {result.tax && (
        <Text size="xs" c="dimmed" mb="lg">
          Доступная база: имущественный {formatRub(result.tax.propertyBaseStart)}
          {result.tax.propertyBaseStart <= 0 && ' (исчерпан — в прогнозе не начисляется)'}, проценты{' '}
          {formatRub(result.tax.interestBaseStart)}
          {result.tax.interestBaseStart <= 0 && ' (исчерпан — в прогнозе не начисляется)'}
        </Text>
      )}

      <Stack gap="sm">
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
                {hasHistory && `, ${todayMonth + payoffMonth}-й месяц ипотеки`}) накопления
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
                hasHistory
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
              {hasHistory ? (
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

        {/* Сколько уже пройдено — только в режиме ипотеки с историей (§6 дизайна таймлайна) */}
        {hasHistory && history && (
          <InsightCard icon={<IconHistory size={18} />} color="grape" title="Сколько уже пройдено">
            За {formatMonths(todayMonth)} по этой ипотеке погашено{' '}
            <b>{formatRub(Math.max(0, history[0] - (history.at(-1) ?? 0)))}</b> тела кредита из{' '}
            <b>{formatRub(history[0])}</b> и уплачено{' '}
            <b>{formatRub(linkedMortgage?.paidInterest ?? 0)}</b> процентов. Осталось{' '}
            <b>{formatRub(history.at(-1) ?? 0)}</b>.
          </InsightCard>
        )}
      </Stack>
    </Paper>
  )
})
