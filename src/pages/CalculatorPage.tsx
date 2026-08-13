import { useEffect, useState } from 'react'
import { Stack, Button, Group, Skeleton, Alert, Text } from '@mantine/core'
import { IconHome2, IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { notifications } from '@mantine/notifications'
import { ParamsSection } from '../components/sections/ParamsSection'
import { SlipSection } from '../components/sections/SlipSection'
import { InsightsSection } from '../components/sections/InsightsSection'
import { ChartsSection } from '../components/sections/ChartsSection'
import { MethodologySection } from '../components/sections/MethodologySection'
import { MortgageModeBanner } from '../components/calculator/MortgageModeBanner'
import { TRACKER_ENABLED, ApiError } from '../api/client'
import { getMortgage } from '../api/mortgages'
import { useAuthStore } from '../store/useAuthStore'
import { useCalculatorStore, linkFromMortgage } from '../store/useCalculatorStore'
import { mortgageToParams, accountSettingsFromParams } from '../lib/mortgageToParams'
import type { MortgageRequest } from '../api/types'

export default function CalculatorPage() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated())
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const linkedMortgageId = useCalculatorStore((s) => s.linkedMortgage?.id ?? null)
  const mortgageFact = useCalculatorStore((s) => s.mortgageFact)
  const factError = useCalculatorStore((s) => s.factError)
  const enterMortgageMode = useCalculatorStore((s) => s.enterMortgageMode)
  const exitMortgageMode = useCalculatorStore((s) => s.exitMortgageMode)
  const setFactError = useCalculatorStore((s) => s.setFactError)

  // Кнопка «Повторить» на алерте ошибки инкрементирует счётчик — он в зависимостях эффекта
  // ниже, поэтому повторный запрос уходит без размонтирования страницы.
  const [retryTick, setRetryTick] = useState(0)

  const showTrackerButton =
    TRACKER_ENABLED && isAuthenticated && result.loanAmount > 0 && linkedMortgageId === null

  // Гейт загрузки факта (§8.4 спеки continuous-simulation-design): mortgageFact не персистится
  // и пересобирается из данных сервера при каждом входе на страницу — пока запрос в полёте,
  // расчёт недостоверен и на экран не выводится (не «примерные» цифры, а честный скелетон/алерт).
  const pending = linkedMortgageId !== null && mortgageFact === null && factError === null
  const failed = linkedMortgageId !== null && factError !== null

  // С4: актуализация из трекера при монтировании и при смене привязанной ипотеки —
  // параметры пересчитываются из свежих данных сервера, а не из снимка (§3.3 спеки).
  useEffect(() => {
    if (!TRACKER_ENABLED || !isAuthenticated || linkedMortgageId === null) return undefined

    let cancelled = false
    const settings = accountSettingsFromParams(useCalculatorStore.getState().ownParams)

    getMortgage(linkedMortgageId)
      .then(({ mortgage, events }) => {
        if (cancelled) return
        const mapped = mortgageToParams({ mortgage, events, settings, today: new Date() })
        enterMortgageMode(linkFromMortgage(mortgage, mapped), mapped.params, mapped.fact)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) {
          exitMortgageMode()
          notifications.show({ message: 'Ипотека удалена, вернулись к вашим параметрам', color: 'yellow' })
          return
        }
        // Сеть, 5xx и т.п. — не выкидываем из режима ипотеки (§8.4 спеки): показываем алерт
        // вместо расчёта, баннер держит последние известные скаляры из персиста.
        setFactError(e instanceof Error ? e.message : 'Не удалось загрузить данные ипотеки')
      })

    return () => {
      cancelled = true
    }
  }, [linkedMortgageId, isAuthenticated, enterMortgageMode, exitMortgageMode, setFactError, retryTick])

  const handleCreateFromCalculator = () => {
    const prefill: Partial<MortgageRequest> = {
      propertyPrice: params.apartmentPrice,
      downPayment: params.downPayment,
      principal: result.loanAmount,
      rate: params.itRate,
      termMonths: params.termYears * 12,
      monthlyPayment: result.minPayment,
      startedOn: new Date().toISOString().slice(0, 10),
      // Уже введённые (гостем или пользователем) израсходованные базы вычетов переносим
      // как есть — это факт про конкретную квартиру/кредит, а не про расчёт (§1.3 дизайна
      // docs/specs/2026-08-13-mortgage-timeline-design.md), и MortgageForm их уже подхватывает
      // из `initial`.
      usedPropertyBase: params.usedPropertyBase,
      usedInterestBase: params.usedInterestBase,
    }
    navigate('/tracker/new', { state: { prefill } })
  }

  return (
    <Stack gap="xl">
      <MortgageModeBanner />

      {failed ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Stack gap="sm">
            <Text size="sm">Не удалось загрузить данные ипотеки — расчёт не показан. {factError}</Text>
            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                leftSection={<IconRefresh size={14} />}
                onClick={() => {
                  setFactError(null)
                  setRetryTick((t) => t + 1)
                }}
              >
                Повторить
              </Button>
              <Button size="xs" variant="light" color="gray" onClick={exitMortgageMode}>
                К моим параметрам
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : pending ? (
        <Stack gap="xl">
          <Skeleton height={320} radius="md" />
          <Skeleton height={180} radius="md" />
          <Skeleton height={420} radius="md" />
        </Stack>
      ) : (
        <>
          <ParamsSection />
          <SlipSection />
          {showTrackerButton && (
            <Group justify="flex-end">
              <Button
                leftSection={<IconHome2 size={16} />}
                variant="light"
                onClick={handleCreateFromCalculator}
              >
                Завести ипотеку из текущего расчёта
              </Button>
            </Group>
          )}
          <InsightsSection />
          <ChartsSection />
        </>
      )}

      <MethodologySection />
    </Stack>
  )
}
