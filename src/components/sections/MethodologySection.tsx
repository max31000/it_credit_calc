import { memo } from 'react'
import {
  Paper,
  Text,
  Accordion,
  Stack,
  Group,
  ThemeIcon,
  Table,
  Box,
  List,
} from '@mantine/core'
import { IconCalculator, IconReceipt, IconAlertTriangle, IconListCheck } from '@tabler/icons-react'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { formatRub } from '../../lib/formatters'

export const MethodologySection = memo(function MethodologySection() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const linkedMortgage = useCalculatorStore((s) => s.linkedMortgage)
  const hasHistory = !!linkedMortgage?.history && linkedMortgage.history.length > 0

  return (
    <Paper p="lg" shadow="sm" radius="md">
      <Group gap="xs" mb="md">
        <ThemeIcon color="gray" variant="light">
          <IconCalculator size={18} />
        </ThemeIcon>
        <Text fw={600} size="lg">
          Как это посчитано
        </Text>
      </Group>

      <Accordion variant="separated">
        <Accordion.Item value="model">
          <Accordion.Control>
            <Group gap="xs">
              <ThemeIcon color="blue" variant="light" size="sm">
                <IconCalculator size={14} />
              </ThemeIcon>
              <Text fw={600}>Модель расчёта</Text>
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
                    backgroundColor: 'var(--mantine-color-default-hover)',
                    padding: '0.5rem',
                    borderRadius: 4,
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  PMT = P × r / (1 − (1+r)^(−n)){'\n'}r = годовая ставка / 12 / 100
                </Box>
                <Text size="sm" c="dimmed" mt={4}>
                  P — остаток долга, n — оставшийся срок в месяцах
                </Text>
              </div>

              <div>
                <Text fw={600} size="sm" mb={4}>
                  Гасить досрочно
                </Text>
                <Text size="sm">
                  Каждый месяц весь бюджет ({formatRub(params.freeMonthly)}) уходит в платёж:
                  обязательная часть + досрочка с уменьшением платежа. Аннуитет пересчитывается
                  ежемесячно. После полного погашения долга бюджет инвестируется под доходность
                  вклада.
                </Text>
              </div>

              <div>
                <Text fw={600} size="sm" mb={4}>
                  Копить
                </Text>
                <Text size="sm">
                  Платится только обязательный аннуитет, остаток бюджета ежемесячно инвестируется
                  под {params.depositRate.toFixed(1)}% годовых с капитализацией.
                </Text>
              </div>

              <div>
                <Text fw={600} size="sm" mb={4}>
                  Слёт с льготной программы
                </Text>
                <Text size="sm">
                  В месяц слёта ставка меняется на рыночную (ключевая − дисконт + 1,5%), и в
                  подходе «копить» все накопления немедленно вносятся в досрочное погашение, после
                  чего аннуитет пересчитывается на остаток срока. Подход «гасить досрочно»
                  продолжает гасить, но уже по рыночной ставке.
                </Text>
              </div>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="assumptions">
          <Accordion.Control>
            <Group gap="xs">
              <ThemeIcon color="yellow" variant="light" size="sm">
                <IconListCheck size={14} />
              </ThemeIcon>
              <Text fw={600}>Допущения и упрощения</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <List size="sm" spacing="xs">
              <List.Item>
                Доходность вклада и ставки постоянны на всём горизонте; инфляция не моделируется —
                все суммы в номинальных рублях.
              </List.Item>
              <List.Item>
                Досрочные платежи уменьшают ежемесячный платёж (не срок). Банки обычно позволяют
                выбрать любой вариант.
              </List.Item>
              <List.Item>
                Налоговые вычеты начисляются раз в год и сразу реинвестируются (в накопления или в
                досрочку — в зависимости от подхода).
              </List.Item>
              <List.Item>
                Обязательный платёж вносится всегда, даже если указанный бюджет меньше него.
              </List.Item>
              <List.Item>
                Доход по вкладам показан без НДФЛ на проценты; при крупных суммах фактический доход
                будет ниже.
              </List.Item>
              <List.Item>
                Стартовые накопления: подход «копить» держит их на вкладе, подход «гасить
                досрочно» вносит их в долг в месяц 0 — так стартовый капитал (накопления минус
                долг) у обоих подходов одинаков, и сравнение остаётся честным.
              </List.Item>
              <List.Item>
                Сумма уже полученного вычета переводится в израсходованную базу по маргинальной
                ставке НДФЛ (по указанной зарплате, иначе 13%) — вычет уменьшает доход сверху вниз
                по прогрессивной шкале.
              </List.Item>
              {hasHistory && (
                <List.Item>
                  Прошлое до «сегодня» восстановлено по корректировкам трекера: если банк прислал
                  снимок остатка, он считается авторитетнее расчёта и «затирает» его, а не
                  корректирует.
                </List.Item>
              )}
              {hasHistory && (
                <List.Item>
                  До «сегодня» трекер ведёт только долг, поэтому на графике «Капитал» серая линия
                  в прошлом — это «минус долг», нижняя граница капитала, а не реальные накопления.
                </List.Item>
              )}
            </List>
          </Accordion.Panel>
        </Accordion.Item>

        {params.salary !== null && result.tax && (
          <Accordion.Item value="tax">
            <Accordion.Control>
              <Group gap="xs">
                <ThemeIcon color="orange" variant="light" size="sm">
                  <IconReceipt size={14} />
                </ThemeIcon>
                <Text fw={600}>Налоговые вычеты по годам</Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <Text size="sm">
                  Порядок расчёта: налоговая база года (12 × зарплата) сначала уменьшается на
                  имущественный вычет (база до 2 млн ₽), затем на вычет по фактически уплаченным
                  процентам (суммарная база до 3 млн ₽). Возврат — разница НДФЛ по прогрессивной
                  шкале (13–22%); неиспользованный остаток переносится на следующие годы. Значения
                  ниже — для подхода «копить» (у «гасить досрочно» проценты меньше, вычет по ним —
                  тоже).
                </Text>

                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Имущественный вычет (возврат)
                  </Text>
                  <Text size="sm" fw={600} c="green.7">
                    {formatRub(result.tax.propertyReturnTotal)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Вычет по процентам (возврат за горизонт)
                  </Text>
                  <Text size="sm" fw={600} c="green.7">
                    {formatRub(result.tax.interestReturnTotal)}
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
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        <Accordion.Item value="disclaimer">
          <Accordion.Control>
            <Group gap="xs">
              <ThemeIcon color="red" variant="light" size="sm">
                <IconAlertTriangle size={14} />
              </ThemeIcon>
              <Text fw={600}>Дисклеймер</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" c="dimmed">
              Все расчёты — модельные оценки при заданных вами предпосылках, а не инвестиционная
              рекомендация. Реальные условия банка, налоговые правила и доходность инструментов
              могут отличаться. Перед решением сверяйтесь с кредитным договором и Налоговым
              кодексом РФ.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Paper>
  )
})
