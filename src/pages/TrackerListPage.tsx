import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Group, Loader, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { listMortgages, createMortgage } from '../api/mortgages'
import type { MortgageDto, MortgageRequest } from '../api/types'
import { MortgageCard } from '../components/tracker/MortgageCard'
import { MortgageForm } from '../components/tracker/MortgageForm'

export default function TrackerListPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [mortgages, setMortgages] = useState<MortgageDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const prefill = (location.state as { prefill?: Partial<MortgageRequest> } | null)?.prefill

  const load = useCallback(() => {
    setError(null)
    listMortgages()
      .then(setMortgages)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить список ипотек'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // /tracker/new открывает модалку создания сразу (в т.ч. с префиллом из калькулятора)
  useEffect(() => {
    if (location.pathname.endsWith('/new')) setCreateOpen(true)
  }, [location.pathname])

  const closeCreate = useCallback(() => {
    setCreateOpen(false)
    if (location.pathname.endsWith('/new')) navigate('/tracker', { replace: true })
  }, [location.pathname, navigate])

  const handleCreate = async (data: MortgageRequest) => {
    setSubmitting(true)
    try {
      await createMortgage(data)
      notifications.show({ message: 'Ипотека добавлена', color: 'green' })
      closeCreate()
      load()
    } catch (e) {
      notifications.show({
        title: 'Ошибка',
        message: e instanceof Error ? e.message : 'Не удалось сохранить ипотеку',
        color: 'red',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text fw={600} size="xl">
          Мои ипотеки
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          Добавить ипотеку
        </Button>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {error}
        </Alert>
      )}

      {!error && mortgages === null && (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      )}

      {!error && mortgages !== null && mortgages.length === 0 && (
        <Paper p="xl" radius="md" withBorder>
          <Text c="dimmed" ta="center">
            Пока нет ни одной ипотеки. Добавьте первую, чтобы отслеживать остаток и платежи.
          </Text>
        </Paper>
      )}

      {!error && mortgages !== null && mortgages.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {mortgages.map((m) => (
            <MortgageCard key={m.id} mortgage={m} />
          ))}
        </SimpleGrid>
      )}

      <Modal opened={createOpen} onClose={closeCreate} title="Новая ипотека" size="lg">
        <MortgageForm initial={prefill} submitting={submitting} onSubmit={handleCreate} onCancel={closeCreate} />
      </Modal>
    </Stack>
  )
}
