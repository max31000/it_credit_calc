import { memo, useCallback } from 'react'
import { Paper, Text, Divider, SimpleGrid, Stack, Alert, Group, Box } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { SliderInput } from '../controls/SliderInput'
import { NumericInput } from '../controls/NumericInput'
import { InfoTooltip } from '../controls/InfoTooltip'
import { relinkLoan } from '../../lib/loanLink'
import { formatRub, formatPct } from '../../lib/formatters'

export const ParamsSection = memo(function ParamsSection() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const setParam = useCalculatorStore((s) => s.setParam)
  const setParams = useCalculatorStore((s) => s.setParams)

  const loanAmount = result.loanAmount
  const downPaymentPct = params.apartmentPrice > 0 ? (params.downPayment / params.apartmentPrice) * 100 : 0
  const maxLoan = Math.max(0, Math.round(params.apartmentPrice * 0.9))
  const investMonthly = Math.max(0, params.freeMonthly - result.minPayment)

  // Цена меняется — relinkLoan сохраняет процент взноса (§6 спеки); один setParams — один пересчёт.
  const handleApartmentPrice = useCallback(
    (v: number) => {
      const next = relinkLoan(
        { propertyPrice: params.apartmentPrice, downPayment: params.downPayment, principal: loanAmount },
        'propertyPrice',
        v,
      )
      setParams({ apartmentPrice: next.propertyPrice, downPayment: next.downPayment })
    },
    [setParams, params.apartmentPrice, params.downPayment, loanAmount],
  )

  const handleDownPayment = useCallback(
    (v: number) => {
      const next = relinkLoan(
        { propertyPrice: params.apartmentPrice, downPayment: params.downPayment, principal: loanAmount },
        'downPayment',
        v,
      )
      setParam('downPayment', next.downPayment)
    },
    [setParam, params.apartmentPrice, params.downPayment, loanAmount],
  )

  // Сумма кредита двигается — меняется взнос (цена фиксирована)
  const handleLoanAmount = useCallback(
    (v: number) => {
      const next = relinkLoan(
        { propertyPrice: params.apartmentPrice, downPayment: params.downPayment, principal: loanAmount },
        'principal',
        v,
      )
      setParam('downPayment', next.downPayment)
    },
    [setParam, params.apartmentPrice, params.downPayment, loanAmount],
  )

  const handleSalary = useCallback(
    (v: number | null) => {
      setParam('salary', v === null || v <= 0 ? null : v)
    },
    [setParam],
  )

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Text fw={600} size="lg">
        Параметры ипотеки
      </Text>
      <Divider mb="md" mt="xs" />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
        {/* Левая колонка: квартира и кредит */}
        <Stack gap="lg">
          <SliderInput
            label="Стоимость квартиры"
            value={params.apartmentPrice}
            min={1_000_000}
            max={30_000_000}
            step={50_000}
            inputMax={150_000_000}
            onChange={handleApartmentPrice}
            format={formatRub}
            suffix=" ₽"
            marks={[
              { value: 1_000_000, label: '1М' },
              { value: 10_000_000, label: '10М' },
              { value: 20_000_000, label: '20М' },
              { value: 30_000_000, label: '30М' },
            ]}
          />

          <SliderInput
            label="Первоначальный взнос"
            value={params.downPayment}
            min={0}
            max={params.apartmentPrice}
            step={10_000}
            inputMax={params.apartmentPrice}
            onChange={handleDownPayment}
            format={formatRub}
            suffix=" ₽"
            rightHint={
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {downPaymentPct.toFixed(1)}%
              </Text>
            }
            marks={[
              { value: 0, label: '0%' },
              { value: params.apartmentPrice * 0.25, label: '25%' },
              { value: params.apartmentPrice * 0.5, label: '50%' },
              { value: params.apartmentPrice, label: '100%' },
            ]}
          />

          <SliderInput
            label="Сумма кредита"
            value={loanAmount}
            min={0}
            max={maxLoan}
            step={10_000}
            inputMax={params.apartmentPrice}
            onChange={handleLoanAmount}
            format={formatRub}
            suffix=" ₽"
            color="blue"
            tooltip="Кредит = стоимость − первоначальный взнос. Двигая эту шкалу, вы меняете взнос."
            marks={[
              { value: 0, label: '0' },
              { value: Math.round(maxLoan / 2), label: formatRub(maxLoan / 2) },
              { value: maxLoan, label: formatRub(maxLoan) },
            ]}
          />

          {loanAmount === 0 && (
            <Alert color="green" variant="light">
              Кредит не требуется — взнос покрывает всю стоимость.
            </Alert>
          )}

          <SliderInput
            label="Льготная ставка"
            value={params.itRate}
            min={3}
            max={12}
            step={0.1}
            onChange={(v) => setParam('itRate', v)}
            format={formatPct}
            suffix=" %"
            decimalScale={1}
            color="green"
            marks={[
              { value: 3, label: '3%' },
              { value: 6, label: '6%' },
              { value: 9, label: '9%' },
              { value: 12, label: '12%' },
            ]}
          />

          <SliderInput
            label="Срок ипотеки"
            value={params.termYears}
            min={5}
            max={30}
            step={1}
            inputMin={1}
            onChange={(v) => setParam('termYears', v)}
            format={(v) => `${v} лет`}
            suffix=" лет"
            marks={[
              { value: 5, label: '5' },
              { value: 10, label: '10' },
              { value: 20, label: '20' },
              { value: 30, label: '30 лет' },
            ]}
          />
        </Stack>

        {/* Правая колонка: деньги */}
        <Stack gap="lg">
          <Stack gap={4}>
            <SliderInput
              label="Бюджет на ипотеку в месяц"
              value={params.freeMonthly}
              min={20_000}
              max={500_000}
              step={5_000}
              inputMax={5_000_000}
              onChange={(v) => setParam('freeMonthly', v)}
              format={(v) => `${formatRub(v)}/мес`}
              suffix=" ₽"
              tooltip="Сколько всего вы готовы направлять на ипотечные цели каждый месяц: обязательный платёж + досрочка или инвестиции."
              marks={[
                { value: 20_000, label: '20к' },
                { value: 100_000, label: '100к' },
                { value: 250_000, label: '250к' },
                { value: 500_000, label: '500к' },
              ]}
            />
            {params.freeMonthly < result.minPayment && loanAmount > 0 && (
              <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                <Text size="sm">
                  Бюджет меньше обязательного платежа ({formatRub(result.minPayment)}/мес). Расчёт
                  предполагает, что платёж всё равно вносится; на досрочку и инвестиции не остаётся
                  ничего, подходы неразличимы.
                </Text>
              </Alert>
            )}
            {params.freeMonthly > result.minPayment && loanAmount > 0 && (
              <Text size="xs" c="dimmed">
                Сверх обязательного платежа остаётся {formatRub(investMonthly)}/мес — досрочка или
                инвестиции.
              </Text>
            )}
          </Stack>

          <SliderInput
            label="Доходность вклада / облигаций"
            value={params.depositRate}
            min={4}
            max={30}
            step={0.1}
            onChange={(v) => setParam('depositRate', v)}
            format={(v) => `${v.toFixed(1)}% годовых`}
            suffix=" %"
            decimalScale={1}
            tooltip="Ожидаемая доходность, под которую размещаются накопления при подходе «копить»."
            marks={[
              { value: 4, label: '4%' },
              { value: 10, label: '10%' },
              { value: 16, label: '16%' },
              { value: 22, label: '22%' },
              { value: 30, label: '30%' },
            ]}
          />

          <Stack gap={4}>
            <SliderInput
              label="Горизонт сравнения"
              value={params.horizonYears}
              min={3}
              max={30}
              step={1}
              onChange={(v) => setParam('horizonYears', Math.min(v, params.termYears))}
              format={(v) => `${v} лет`}
              suffix=" лет"
              marks={[
                { value: 3, label: '3' },
                { value: 10, label: '10' },
                { value: 20, label: '20' },
                { value: 30, label: '30 лет' },
              ]}
            />
            {params.horizonYears >= params.termYears && (
              <Text size="xs" c="dimmed">
                Ограничено сроком ипотеки
              </Text>
            )}
          </Stack>

          <Box>
            <Group gap={4} align="center" mb={4}>
              <Text size="sm" fw={500}>
                Зарплата до налогов (₽/мес)
              </Text>
              <InfoTooltip text="Нужна только для расчёта налоговых вычетов: имущественного (база до 2 млн ₽) и по процентам (база до 3 млн ₽). Возврат ограничен фактически уплаченным НДФЛ по прогрессивной шкале." />
            </Group>
            <NumericInput
              value={params.salary}
              onChange={handleSalary}
              allowEmpty
              min={0}
              max={10_000_000}
              step={10_000}
              placeholder="0"
              suffix=" ₽/мес"
              thousandSeparator=" "
              description="0 — вычеты не учитывать"
            />
            {params.salary !== null && result.tax && (
              <Text size="xs" c="dimmed" mt={4}>
                Ставка НДФЛ {(result.tax.ndflRate * 100).toFixed(0)}%. Вычеты за горизонт:{' '}
                {formatRub(result.tax.propertyReturnTotal + result.tax.interestReturnTotal)}
              </Text>
            )}
          </Box>
        </Stack>
      </SimpleGrid>
    </Paper>
  )
})
