import { Stack, Button, Group } from '@mantine/core'
import { IconHome2 } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { ParamsSection } from '../components/sections/ParamsSection'
import { SlipSection } from '../components/sections/SlipSection'
import { InsightsSection } from '../components/sections/InsightsSection'
import { ChartsSection } from '../components/sections/ChartsSection'
import { MethodologySection } from '../components/sections/MethodologySection'
import { TRACKER_ENABLED } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'
import { useCalculatorStore } from '../store/useCalculatorStore'
import type { MortgageRequest } from '../api/types'

export default function CalculatorPage() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated())
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)

  const showTrackerButton = TRACKER_ENABLED && isAuthenticated && result.loanAmount > 0

  const handleCreateFromCalculator = () => {
    const prefill: Partial<MortgageRequest> = {
      propertyPrice: params.apartmentPrice,
      downPayment: params.downPayment,
      principal: result.loanAmount,
      rate: params.itRate,
      termMonths: params.termYears * 12,
      monthlyPayment: result.minPayment,
      startedOn: new Date().toISOString().slice(0, 10),
    }
    navigate('/tracker/new', { state: { prefill } })
  }

  return (
    <Stack gap="xl">
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
      <MethodologySection />
    </Stack>
  )
}
