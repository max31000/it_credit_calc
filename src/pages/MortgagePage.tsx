import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Group, Loader, Modal, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconChartLine, IconPlus } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import {
  getMortgage,
  updateMortgage,
  deleteMortgage,
  createEvent,
  deleteEvent,
} from '../api/mortgages'
import type { MortgageDetails, MortgageEventRequest, MortgageRequest } from '../api/types'
import { computeMortgageState } from '../lib/tracker'
import { mortgageToParams, accountSettingsFromParams } from '../lib/mortgageToParams'
import { useCalculatorStore } from '../store/useCalculatorStore'
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
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [addEventOpen, setAddEventOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null)

  const load = useCallback(() => {
    setError(null)
    getMortgage(mortgageId)
      .then(setDetails)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить ипотеку'))
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

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={16} />}>
        {error}
      </Alert>
    )
  }

  if (!details) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const { mortgage, events } = details
  const state = computeMortgageState(mortgage, events, new Date())
  const mortgageClosed = state.currentBalance === 0

  const handleOpenInCalculator = () => {
    const settings = accountSettingsFromParams(useCalculatorStore.getState().ownParams)
    const { params, state: mState, termFallback } = mortgageToParams({
      mortgage,
      events,
      settings,
      today: new Date(),
    })
    enterMortgageMode(
      {
        id: mortgage.id,
        title: mortgage.title,
        asOf: mState.asOf,
        balance: mState.currentBalance,
        payment: mState.currentPayment,
        termFallback,
      },
      params,
    )
    navigate('/')
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Stack gap={0}>
          <Text fw={600} size="xl">
            {mortgage.title}
          </Text>
          {mortgage.bank && (
            <Text c="dimmed" size="sm">
              {mortgage.bank}
            </Text>
          )}
        </Stack>
        <Group>
          <Tooltip label="Ипотека погашена — считать нечего" disabled={!mortgageClosed}>
            {/* Не используем нативный disabled — иначе Tooltip не поймает наведение мышью */}
            <Button
              variant="light"
              leftSection={<IconChartLine size={16} />}
              onClick={mortgageClosed ? undefined : handleOpenInCalculator}
              aria-disabled={mortgageClosed}
              style={mortgageClosed ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              Открыть в калькуляторе
            </Button>
          </Tooltip>
          <Button variant="default" onClick={() => setEditOpen(true)}>
            Редактировать
          </Button>
          <Button variant="default" color="red" onClick={() => setDeleteOpen(true)}>
            Удалить
          </Button>
        </Group>
      </Group>

      <MortgageStatus state={state} />

      <Paper p="lg" shadow="sm" radius="md">
        <Group justify="space-between" mb="md">
          <Text fw={600} size="lg">
            История корректировок
          </Text>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAddEventOpen(true)}>
            Добавить
          </Button>
        </Group>
        <EventList events={events} onDelete={handleDeleteEvent} deletingId={deletingEventId} />
      </Paper>

      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Редактирование ипотеки" size="lg">
        <MortgageForm
          initial={mortgage}
          submitting={submitting}
          onSubmit={handleEdit}
          onCancel={() => setEditOpen(false)}
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
    </Stack>
  )
}
