import { useState } from 'react'
import { Stack, Text, Group, SegmentedControl, Collapse } from '@mantine/core'
import { useCalculatorStore } from '../../store/useCalculatorStore'
import { NumericInput } from '../controls/NumericInput'
import { InfoTooltip } from '../controls/InfoTooltip'
import { refundToBase } from '../../lib/engine'
import { formatRub } from '../../lib/formatters'

const PROPERTY_DEDUCTION_LIMIT = 2_000_000
const INTEREST_DEDUCTION_LIMIT = 3_000_000

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

type PropertySegment = 'none' | 'partial' | 'full'

/**
 * Блок «Налоговые вычеты» в `ParamsSection` (§1.5, §8 дизайна таймлайна). Пользователь вводит
 * то, что реально знает — суммы уже полученных возвратов, — а не базу вычета; пересчёт в базу
 * идёт через `refundToBase` (маргинальная ставка НДФЛ, §1.5).
 *
 * Раскрывается только при указанной зарплате — без неё вычеты не считаются вовсе.
 */
export function DeductionsBlock() {
  const params = useCalculatorStore((s) => s.params)
  const result = useCalculatorStore((s) => s.result)
  const setParam = useCalculatorStore((s) => s.setParam)

  // Состояние переключателя выводится из usedPropertyBase — отдельного персиста нет (§8.6
  // дизайна). Локальный оверрайд нужен только на время самого клика «Получена частично»:
  // без него нулевой usedPropertyBase немедленно откатывал бы сегмент обратно на «Не получал».
  const [segmentOverride, setSegmentOverride] = useState<PropertySegment | null>(null)

  if (params.salary === null || !result.tax) {
    return (
      <Text size="xs" c="dimmed">
        Укажите зарплату, чтобы учитывать вычеты
      </Text>
    )
  }

  const { salary } = params
  const propertyLimit = Math.min(PROPERTY_DEDUCTION_LIMIT, params.apartmentPrice)
  const ndflRate = result.tax.ndflRate

  const derivedSegment: PropertySegment =
    params.usedPropertyBase <= 0 ? 'none' : params.usedPropertyBase >= propertyLimit ? 'full' : 'partial'
  const segment = segmentOverride ?? derivedSegment

  const handleSegmentChange = (value: string) => {
    const v = value as PropertySegment
    setSegmentOverride(v === 'partial' ? 'partial' : null)
    if (v === 'none') setParam('usedPropertyBase', 0)
    if (v === 'full') setParam('usedPropertyBase', propertyLimit)
  }

  const propertyRefund = Math.round(params.usedPropertyBase * ndflRate)
  const propertyRefundMax = Math.round(propertyLimit * ndflRate)
  const handlePropertyRefund = (v: number | null) => {
    setParam('usedPropertyBase', clamp(Math.round(refundToBase(v ?? 0, salary)), 0, propertyLimit))
  }

  const interestRefund = Math.round(params.usedInterestBase * ndflRate)
  const interestRefundMax = Math.round(INTEREST_DEDUCTION_LIMIT * ndflRate)
  const handleInterestRefund = (v: number | null) => {
    setParam('usedInterestBase', clamp(Math.round(refundToBase(v ?? 0, salary)), 0, INTEREST_DEDUCTION_LIMIT))
  }

  const propertyExhausted = result.tax.propertyBaseStart <= 0 && params.usedPropertyBase > 0
  const interestExhausted = result.tax.interestBaseStart <= 0 && params.usedInterestBase > 0

  return (
    <Stack gap="sm">
      <Stack gap={4}>
        <Group gap={4} align="center">
          <Text size="sm" fw={500}>
            Имущественный вычет
          </Text>
          <InfoTooltip text="Вычет за покупку жилья: база до 2 млн ₽ (или до стоимости квартиры, если она меньше). Если уже что-то вернули по этой сделке — укажите сумму, прогноз не начислит её повторно." />
        </Group>
        <SegmentedControl
          value={segment}
          onChange={handleSegmentChange}
          data={[
            { value: 'none', label: 'Не получал' },
            { value: 'partial', label: 'Получен частично' },
            { value: 'full', label: 'Получен полностью' },
          ]}
          fullWidth
        />
        <Collapse in={segment === 'partial'}>
          <NumericInput
            label="Уже вернули, ₽"
            value={propertyRefund}
            onChange={handlePropertyRefund}
            min={0}
            max={propertyRefundMax}
            thousandSeparator=" "
            suffix=" ₽"
          />
        </Collapse>
        <Text size="xs" c="dimmed">
          Израсходовано базы ≈ {formatRub(params.usedPropertyBase)} из {formatRub(propertyLimit)}
          {propertyExhausted
            ? ' — исчерпан, в прогнозе не начисляется'
            : ` · осталось базы ≈ ${formatRub(result.tax.propertyBaseStart)} (к возврату ≈ ${formatRub(Math.round(result.tax.propertyBaseStart * ndflRate))})`}
        </Text>
      </Stack>

      <Stack gap={4}>
        <Group gap={4} align="center">
          <Text size="sm" fw={500}>
            Вычет по процентам
          </Text>
          <InfoTooltip text="Вычет по уплаченным ипотечным процентам: база до 3 млн ₽ за всё время кредита. В режиме ипотеки удобнее указывать его через форму ипотеки — там есть помощник «по какой год получен». Проценты прошлых лет по этой ипотеке и статус вычета по каждому году видны в таблице вычетов в «Выводах»." />
        </Group>
        <NumericInput
          label="Уже вернули по процентам, ₽"
          value={interestRefund}
          onChange={handleInterestRefund}
          min={0}
          max={interestRefundMax}
          thousandSeparator=" "
          suffix=" ₽"
        />
        <Text size="xs" c="dimmed">
          Израсходовано базы ≈ {formatRub(params.usedInterestBase)} из {formatRub(INTEREST_DEDUCTION_LIMIT)}
          {interestExhausted
            ? ' — исчерпан, в прогнозе не начисляется'
            : ` · осталось базы ≈ ${formatRub(result.tax.interestBaseStart)} (к возврату ≈ ${formatRub(Math.round(result.tax.interestBaseStart * ndflRate))})`}
        </Text>
      </Stack>
    </Stack>
  )
}
