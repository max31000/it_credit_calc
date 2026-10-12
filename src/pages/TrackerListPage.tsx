import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Modal, SimpleGrid, Skeleton } from '@mantine/core'
import { IconHomeDollar, IconPlus } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { EmptyState, ErrorState, Page } from '@mvv42/kit'
import { listMortgages, createMortgage } from '../api/mortgages'
import type { MortgageDetails, MortgageRequest } from '../api/types'
import { MortgageCard } from '../components/tracker/MortgageCard'
import { MortgageForm } from '../components/tracker/MortgageForm'

export default function TrackerListPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [mortgages, setMortgages] = useState<MortgageDetails[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const prefill = (location.state as { prefill?: Partial<MortgageRequest> } | null)?.prefill

  const load = useCallback(() => {
    setError(null)
    listMortgages()
      .then(setMortgages)
      .catch(setError)
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

  const addButton = (
    <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
      Добавить ипотеку
    </Button>
  )

  return (
    <Page
      width="wide"
      title="Мои ипотеки"
      description="Остаток, платёж и история корректировок по каждой ипотеке"
      actions={mortgages !== null && mortgages.length > 0 ? addButton : undefined}
    >
      {error !== null && <ErrorState error={error} onRetry={load} />}

      {error === null && mortgages === null && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" aria-busy="true" aria-label="Загрузка">
          <Skeleton height={176} radius="md" />
          <Skeleton height={176} radius="md" />
        </SimpleGrid>
      )}

      {error === null && mortgages !== null && mortgages.length === 0 && (
        <EmptyState
          icon={<IconHomeDollar size={22} />}
          title="Пока нет ни одной ипотеки"
          description="Добавьте первую, чтобы отслеживать остаток и платежи и открыть её в калькуляторе."
          action={addButton}
        />
      )}

      {error === null && mortgages !== null && mortgages.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {mortgages.map((d) => (
            <MortgageCard key={d.mortgage.id} mortgage={d.mortgage} events={d.events} />
          ))}
        </SimpleGrid>
      )}

      <Modal opened={createOpen} onClose={closeCreate} title="Новая ипотека" size="lg">
        <MortgageForm initial={prefill} submitting={submitting} onSubmit={handleCreate} onCancel={closeCreate} />
      </Modal>
    </Page>
  )
}
