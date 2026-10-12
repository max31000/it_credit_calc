import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Group, Modal, Skeleton, Stack, Text, Tooltip } from '@mantine/core'
import { IconChartLine, IconPlus } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { ErrorState, Page, Section } from '@mvv42/kit'
import {
  getMortgage,
  updateMortgage,
  deleteMortgage,
  createEvent,
  deleteEvent,
} from '../api/mortgages'
import type { MortgageDetails, MortgageEventRequest, MortgageRequest } from '../api/types'
import { mortgageToParams, accountSettingsFromParams } from '../lib/mortgageToParams'
import { useCalculatorStore, linkFromMortgage } from '../store/useCalculatorStore'
import { MortgageStatus } from '../components/tracker/MortgageStatus'
import { MortgageForm } from '../components/tracker/MortgageForm'
import { EventForm } from '../components/tracker/EventForm'
import { EventList } from '../components/tracker/EventList'

export default function MortgagePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const mortgageId = Number(id)
  const enterMortgageMode = useCalculatorStore((s) => s.enterMortgageMode)

  const [details, setDetails] = useState<MortgageDetails | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [addEventOpen, setAddEventOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null)

  const load = useCallback(() => {
    setError(null)
    getMortgage(mortgageId)
      .then(setDetails)
      .catch(setError)
  }, [mortgageId])

  useEffect(() => {
    load()
  }, [load])

  const handleEdit = async (data: MortgageRequest) => {
    setSubmitting(true)
    try {
      await updateMortgage(mortgageId, data)
      setEditOpen(false)
      load()
      notifications.show({ message: 'Изменения сохранены', color: 'green' })
    } catch (e) {
      notifications.show({
        title: 'Ошибка',
        message: e instanceof Error ? e.message : 'Не удалось сохранить изменения',
        color: 'red',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteMortgage = async () => {
    setSubmitting(true)
    try {
      await deleteMortgage(mortgageId)
      notifications.show({ message: 'Ипотека удалена', color: 'green' })
      navigate('/tracker', { replace: true })
    } catch (e) {
      notifications.show({
        title: 'Ошибка',
        message: e instanceof Error ? e.message : 'Не удалось удалить ипотеку',
        color: 'red',
      })
      setSubmitting(false)
    }
  }

  const handleAddEvent = async (data: MortgageEventRequest) => {
    setSubmitting(true)
    try {
      await createEvent(mortgageId, data)
      setAddEventOpen(false)
      load()
      notifications.show({ message: 'Корректировка добавлена', color: 'green' })
    } catch (e) {
      notifications.show({
        title: 'Ошибка',
        message: e instanceof Error ? e.message : 'Не удалось сохранить корректировку',
        color: 'red',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteEvent = async (eventId: number) => {
    setDeletingEventId(eventId)
    try {
      await deleteEvent(mortgageId, eventId)
      load()
    } catch (e) {
      notifications.show({
        title: 'Ошибка',
        message: e instanceof Error ? e.message : 'Не удалось удалить корректировку',
        color: 'red',
      })
    } finally {
      setDeletingEventId(null)
    }
  }

  if (error !== null) {
    return (
      <Page width="wide">
        <ErrorState error={error} onRetry={load} />
      </Page>
    )
  }

  if (!details) {
    return (
      <Page width="wide" aria-busy="true" aria-label="Загрузка">
        <Skeleton height={40} width="40%" radius="sm" />
        <Skeleton height={220} radius="md" />
        <Skeleton height={260} radius="md" />
      </Page>
    )
  }

  const { mortgage, events } = details
  // Один вызов `mortgageToParams` вместо двух отдельных (`computeMortgageState` +
  // `buildDebtHistory`) — оба уже посчитаны внутри `buildMortgageFact` (§2.6 спеки
  // continuous-simulation-design). Помощник «по какой год получен вычет по процентам»
  // (§1.5, §8 дизайна таймлайна) берёт данные из той же реконструкции истории.
  const settings = accountSettingsFromParams(useCalculatorStore.getState().ownParams)
  const mapped = mortgageToParams({ mortgage, events, settings, today: new Date() })
  const state = mapped.state
  const mortgageClosed = state.currentBalance === 0

  const handleOpenInCalculator = () => {
    enterMortgageMode(linkFromMortgage(mortgage, mapped), mapped.params, mapped.fact)
    navigate('/')
  }

  return (
    <Page
      width="wide"
      eyebrow="Трекер"
      title={mortgage.title}
      description={mortgage.bank ?? undefined}
      actions={
        <Group gap="xs">
          <Tooltip label="Ипотека погашена — считать нечего" disabled={!mortgageClosed}>
            {/* Не используем нативный disabled — иначе Tooltip не поймает наведение мышью */}
            <Button
              variant="light"
              leftSection={<IconChartLine size={16} />}
              onClick={mortgageClosed ? undefined : handleOpenInCalculator}
              aria-disabled={mortgageClosed}
              data-disabled={mortgageClosed || undefined}
            >
              Открыть в калькуляторе
            </Button>
          </Tooltip>
          <Button variant="default" onClick={() => setEditOpen(true)}>
            Редактировать
          </Button>
          <Button variant="default" c="red" onClick={() => setDeleteOpen(true)}>
            Удалить
          </Button>
        </Group>
      }
    >
      <MortgageStatus state={state} />

      <Section
        title="История корректировок"
        description="Выписки банка, смена ставки, досрочные погашения"
        padding="none"
        actions={
          <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setAddEventOpen(true)}>
            Добавить
          </Button>
        }
      >
        <EventList events={events} onDelete={handleDeleteEvent} deletingId={deletingEventId} />
      </Section>

      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Редактирование ипотеки" size="lg">
        <MortgageForm
          initial={mortgage}
          submitting={submitting}
          onSubmit={handleEdit}
          onCancel={() => setEditOpen(false)}
          deductionHelp={{
            interestByYear: mapped.fact.history.interestByYear,
            paidInterest: mapped.fact.history.paidInterest,
          }}
        />
      </Modal>

      <Modal opened={addEventOpen} onClose={() => setAddEventOpen(false)} title="Новая корректировка">
        <EventForm
          mortgageStartedOn={mortgage.startedOn}
          submitting={submitting}
          onSubmit={handleAddEvent}
          onCancel={() => setAddEventOpen(false)}
        />
      </Modal>

      <Modal opened={deleteOpen} onClose={() => setDeleteOpen(false)} title="Удалить ипотеку?">
        <Stack gap="md">
          <Text size="sm">
            Ипотека «{mortgage.title}» и вся история корректировок будут удалены безвозвратно.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button color="red" onClick={handleDeleteMortgage} loading={submitting}>
              Удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Page>
  )
}
