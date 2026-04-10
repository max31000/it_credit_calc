import { memo, type ReactNode } from 'react'
import {
  Paper,
  Text,
  Accordion,
  Stack,
  Alert,
  Group,
  ThemeIcon,
  Divider,
  Table,
  Box,
} from '@mantine/core'
import {
  IconStar,
  IconCalculator,
  IconShield,
  IconReceipt,
  IconBulb,
  IconTrendingUp,
  IconAlertTriangle,
  IconAlertCircle,
  IconShieldCheck,
} from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { formatRub, formatPct, formatMonths } from '../../lib/formatters'

export const InfoAccordion = memo(function InfoAccordion() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)

  const { summary, safetyPoint, minPayment } = result
  const winner = summary.winner
  const winnerName = winner === 'A' ? 'Досрочное погашение' : winner === 'B' ? 'Инвестиции' : 'Ничья'
  const winnerColor = winner === 'A' ? 'orange' : 'blue'
  const winnerDelta = summary.winnerDelta

  const spread = params.depositRate - params.itRate
  let spreadAdvice: ReactNode
  if (spread > 5) {
    spreadAdvice = (
      <Alert color="blue" variant="light" icon={<IconTrendingUp size={16} />} mb="sm">
        При доходности {formatPct(params.depositRate)} годовых инвестиции значительно обгоняют
        стоимость кредита {formatPct(params.itRate)}. Стратегия Б (инвестиции) предпочтительна на
        горизонте {params.horizonYears} лет.
      </Alert>
    )
  } else if (spread < 2) {
    spreadAdvice = (
      <Alert color="orange" variant="light" mb="sm">
        Разница между доходностью вклада ({formatPct(params.depositRate)}) и ставкой ипотеки (
        {formatPct(params.itRate)}) мала. Досрочное погашение снижает риски и даёт сопоставимый
        результат.
      </Alert>
    )
  } else {
    spreadAdvice = (
      <Alert color="yellow" variant="light" mb="sm">
        Умеренная разница между ставками. Результат зависит от горизонта и ключевой ставки.
      </Alert>
    )
  }

  const investMonthly = Math.max(0, params.freeMonthly - minPayment)

  const safetyMonth =
    safetyPoint !== null ? result.slipAnalysis[safetyPoint]?.slipMonth ?? null : null

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Group gap="xs" mb="md">
        <ThemeIcon color="blue" variant="light">
          <IconBulb size={18} />
        </ThemeIcon>
        <Text fw={600} size="lg">
          Советы и интерпретация результатов
        </Text>
      </Group>

      <Accordion variant="separated" defaultValue="recommendation">
        {/* Recommendation */}
        <Accordion.Item value="recommendation">
          <Accordion.Control>
            <Group gap="xs">
              <ThemeIcon color="green" variant="light" size="sm">
                <IconStar size={14} />
              </ThemeIcon>
              <Text fw={600}>Рекомендация</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {/* Winner block */}
              <Paper p="md" radius="md" mb="sm" style={{ backgroundColor: winner === 'A' ? 'var(--mantine-color-orange-light)' : 'var(--mantine-color-blue-light)' }}>
                <Group gap="sm">
                  <ThemeIcon color={winnerColor} size="lg" variant="light">
                    <IconStar size={18} />
                  </ThemeIcon>
                  <Stack gap={2}>
                    <Text fw={700} size="md" c={`${winnerColor}.7`}>
                      Победитель: Стратегия {winner} ({winnerName})
                    </Text>
                    <Text size="sm">
                      Преимущество: {formatRub(winnerDelta)} на горизонте {params.horizonYears} лет
                    </Text>
                  </Stack>
                </Group>
              </Paper>

              {spreadAdvice}

              {params.slipMonth > 0 && params.slipMonth < 24 && (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} mb="sm">
                  Внимание: при раннем слёте (через {params.slipMonth} мес.) у вас мало накоплений
                  для покрытия нового платежа (
                  {formatRub(result.slipScenario.paymentWithoutPrepay)} ₽). Стратегия А снижает
                  платёж при слёте до {formatRub(result.slipScenario.paymentWithPrepay)} ₽.
                </Alert>
              )}

              {params.freeMonthly <= minPayment && (
                <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} mb="sm">
                  Свободных средств не хватает даже для минимального платежа. Стратегии идентичны.
                  Рассмотрите пересмотр бюджета.
                </Alert>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* How it works */}
        <Accordion.Item value="how-it-works">
          <Accordion.Control>
            <Group gap="xs">
              <ThemeIcon color="blue" variant="light" size="sm">
                <IconCalculator size={14} />
              </ThemeIcon>
              <Text fw={600}>Как работает расчёт</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <div>
                <Text fw={600} size="sm" mb={4}>
                  Аннуитетный платёж
                </Text>
                <Box
                  style={{
                    fontFamily: 'monospace',
                    backgroundColor: 'var(--mantine-color-gray-light)',
                    padding: '0.5rem',
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                >
                  PMT = P × r / (1 − (1+r)^(−n)){'\n'}r = годовая_ставка / 12 / 100
                </Box>
                <Text size="sm" c="dimmed" mt={4}>
                  Где P — сумма кредита, n — срок в месяцах
                </Text>
              </div>

              <div>
                <Text fw={600} size="sm" mb={4}>
                  Стратегия А: досрочное погашение
                </Text>
                <Text size="sm">
                  Каждый месяц: фиксированный бюджет {formatRub(params.freeMonthly)}. Аннуитет
                  PMT_A(t) пересчитывается и убывает. Разница freeMonthly − PMT_A(t) идёт на
                  досрочное погашение тела долга. Накопления = 0.
                </Text>
              </div>

              <div>
                <Text fw={600} size="sm" mb={4}>
                  Стратегия Б: инвестиции
                </Text>
                <Text size="sm">
                  PMT фиксируется один раз. {formatRub(investMonthly)}/мес инвестируются под{' '}
                  {formatPct(params.depositRate)} годовых. S(t) = S(t−1) × (1 + r_dep) +{' '}
                  {formatRub(investMonthly)}. Накопления на момент слёта направляются на погашение
                  долга.
                </Text>
              </div>

              <div>
                <Text fw={600} size="sm" mb={4}>
                  Налоговые вычеты
                </Text>
                <Text size="sm">
                  Расчёт приближённый: применяется единая маргинальная ставка НДФЛ в зависимости от
                  годового дохода. Вычет по покупке — до 260 000 ₽ (2 млн × 13%). Вычет по
                  процентам — до 390 000 ₽ (3 млн × 13%).
                </Text>
              </div>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Safety point */}
        <Accordion.Item value="safety-point">
          <Accordion.Control>
            <Group gap="xs">
              <ThemeIcon color="green" variant="light" size="sm">
                <IconShield size={14} />
              </ThemeIcon>
              <Text fw={600}>Точка безопасности</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Text size="sm">
                Точка безопасности — месяц, начиная с которого при слёте с льготной ипотеки и
                направлении накоплений на досрочное погашение новый платёж не превысит текущий
                льготный аннуитет ({formatRub(minPayment)}).
              </Text>

              {safetyMonth !== null && safetyPoint !== null ? (
                <Paper style={{ backgroundColor: 'var(--mantine-color-green-light)' }} p="md" radius="md">
                  <Group gap="xs" mb="xs">
                    <IconShieldCheck size={18} color="var(--mantine-color-green-7)" />
                    <Text fw={700} c="green">
                      Точка безопасности: месяц {safetyMonth}
                    </Text>
                  </Group>
                  <Text size="sm" c="green.7" mb="sm">
                    Через {formatMonths(safetyMonth)} после начала ипотеки
                  </Text>
                  <Divider my="xs" />
                  <Text size="sm" mb="xs">
                    Если слёт произойдёт на {safetyMonth}-м месяце:
                  </Text>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Остаток долга Б
                    </Text>
                    <Text size="sm" fw={600}>
                      {formatRub(result.series[safetyMonth]?.debtB ?? 0)}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Накопления Б
                    </Text>
                    <Text size="sm" fw={600} c="green.7">
                      {formatRub(result.series[safetyMonth]?.savingsB ?? 0)}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Платёж после погашения
                    </Text>
                    <Text size="sm" fw={600} c="green.7">
                      ≤ {formatRub(minPayment)}
                    </Text>
                  </Group>
                </Paper>
              ) : (
                <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                  Точка безопасности не достигнута за {params.horizonYears} лет. Попробуйте
                  увеличить свободные средства или горизонт сравнения.
                </Alert>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* Tax deductions — only if salary set */}
        {params.salary !== null && result.tax && (
          <Accordion.Item value="tax">
            <Accordion.Control>
              <Group gap="xs">
                <ThemeIcon color="orange" variant="light" size="sm">
                  <IconReceipt size={14} />
                </ThemeIcon>
                <Text fw={600}>Налоговые вычеты</Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Ежемесячная зарплата до налогов
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatRub(params.salary)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Годовой доход
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatRub(params.salary * 12)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Ставка НДФЛ
                  </Text>
                  <Stack gap={0} align="flex-end">
                    <Text size="sm" fw={600} c="orange.7">
                      {(result.tax.ndflRate * 100).toFixed(0)}%
                    </Text>
                    <Text size="xs" c="dimmed">
                      Упрощённый расчёт: единая маргинальная ставка
                    </Text>
                  </Stack>
                </Group>

                <Divider label="Имущественный вычет (за покупку)" labelPosition="left" my="xs" />

                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    База вычета
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatRub(Math.min(2_000_000, params.apartmentPrice))}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Сумма к возврату
                  </Text>
                  <Text size="sm" fw={600} c="green.7">
                    {formatRub(result.tax.deductionBuy)}
                  </Text>
                </Group>

                {result.tax.byYear.length > 0 && (
                  <Table striped style={{ fontSize: 12 }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Год</Table.Th>
                        <Table.Th>Имущественный</Table.Th>
                        <Table.Th>По процентам</Table.Th>
                        <Table.Th>Итого за год</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.tax.byYear.map((row) => (
                        <Table.Tr key={row.year}>
                          <Table.Td>{row.year}</Table.Td>
                          <Table.Td>{formatRub(row.propertyReturn)}</Table.Td>
                          <Table.Td>{formatRub(row.amount - row.propertyReturn)}</Table.Td>
                          <Table.Td>{formatRub(row.amount)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}

                <Divider label="Вычет по ипотечным процентам" labelPosition="left" my="xs" />

                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Лимит базы по процентам
                  </Text>
                  <Text size="sm" fw={600}>
                    3 000 000 ₽
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Итого к получению
                  </Text>
                  <Text size="sm" fw={600} c="green.7">
                    {formatRub(result.tax.deductionInterestTotal)}
                  </Text>
                </Group>

                <Paper style={{ backgroundColor: 'var(--mantine-color-green-light)' }} p="sm" radius="sm">
                  <Group justify="space-between">
                    <Text fw={600}>Суммарный налоговый вычет</Text>
                    <Text fw={700} size="lg" c="green">
                      {formatRub(result.tax.deductionBuy + result.tax.deductionInterestTotal)}
                    </Text>
                  </Group>
                </Paper>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </Paper>
  )
})
