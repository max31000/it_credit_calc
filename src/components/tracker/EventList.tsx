import { ActionIcon, Badge, Group, Stack, Text } from '@mantine/core'
import { IconHistory, IconTrash } from '@tabler/icons-react'
import { EmptyState } from '@mvv42/kit'
import type { MortgageEventDto, MortgageEventKind } from '../../api/types'
import { formatRub, formatPct } from '../../lib/formatters'

const KIND_LABEL: Record<MortgageEventKind, string> = {
  balance: 'Остаток из выписки',
  rate: 'Смена ставки',
  prepayment: 'Досрочный платёж',
  payment: 'Новый платёж',
}

const KIND_COLOR: Record<MortgageEventKind, string> = {
  balance: 'blue',
  rate: 'orange',
  prepayment: 'green',
  payment: 'grape',
}

interface EventListProps {
  events: MortgageEventDto[]
  onDelete: (eventId: number) => void
  deletingId?: number | null
}

export function EventList({ events, onDelete, deletingId }: EventListProps) {
  if (events.length === 0) {
    return (
      <EmptyState
        compact
        icon={<IconHistory size={22} />}
        title="Корректировок пока нет"
        description="Добавляйте остаток из выписки, смену ставки и досрочные погашения — расчёт станет точнее."
      />
    )
  }

  // История — от новых к старым
  const sorted = [...events].sort((a, b) => {
    if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1
    return b.id - a.id
  })

  return (
    <ul className="cc-list">
      {sorted.map((e) => (
        <li key={e.id} className="cc-list-row">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
              <Group gap={6}>
                <Badge color={KIND_COLOR[e.kind]} variant="light">
                  {KIND_LABEL[e.kind]}
                </Badge>
                <Text size="sm" c="dimmed">
                  {e.occurredOn}
                </Text>
              </Group>
              <Text size="sm" fw={500} className="mvv-num">
                {e.amount !== null && formatRub(e.amount)}
                {e.rate !== null && formatPct(e.rate)}
              </Text>
              {e.note && (
                <Text size="xs" c="dimmed">
                  {e.note}
                </Text>
              )}
            </Stack>
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={() => onDelete(e.id)}
              loading={deletingId === e.id}
              aria-label="Удалить корректировку"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </li>
      ))}
    </ul>
  )
}
