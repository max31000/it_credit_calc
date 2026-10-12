import { beforeEach, describe, expect, it } from 'vitest'
import { useCalculatorStore } from '../useCalculatorStore'

const defaults = { ...useCalculatorStore.getState().params }

beforeEach(() => {
  localStorage.clear()
  useCalculatorStore.setState({
    params: { ...defaults },
    ownParams: { ...defaults },
    slipEnabled: false,
    linkedMortgage: null,
    mortgageFact: null,
    factError: null,
    ownerUserId: null,
  })
})

describe('claimForUser — персист принадлежит одному пользователю', () => {
  it('гость входит: параметры остаются и закрепляются за ним (посев в аккаунт)', () => {
    useCalculatorStore.getState().setParam('freeMonthly', 150_000)

    expect(useCalculatorStore.getState().claimForUser(1)).toBe(false)

    const s = useCalculatorStore.getState()
    expect(s.ownerUserId).toBe(1)
    expect(s.ownParams.freeMonthly).toBe(150_000)
  })

  it('тот же пользователь — ничего не сбрасывается', () => {
    useCalculatorStore.getState().claimForUser(1)
    useCalculatorStore.getState().setParam('freeMonthly', 150_000)

    expect(useCalculatorStore.getState().claimForUser(1)).toBe(false)
    expect(useCalculatorStore.getState().ownParams.freeMonthly).toBe(150_000)
  })

  it('другой пользователь — выход из режима ипотеки и дефолты до синхронизации настроек', () => {
    useCalculatorStore.getState().claimForUser(1)
    useCalculatorStore.getState().setParam('freeMonthly', 150_000)
    useCalculatorStore.setState({
      linkedMortgage: { id: 5, title: 'Ипотека A', asOf: '2026-01-01', balance: 1, payment: 1, termFallback: false, rate: 6, startedOn: '2024-01-01' },
    })

    expect(useCalculatorStore.getState().claimForUser(2)).toBe(true)

    const s = useCalculatorStore.getState()
    expect(s.ownerUserId).toBe(2)
    expect(s.linkedMortgage).toBeNull()
    expect(s.ownParams).toEqual(defaults)
    expect(s.params).toEqual(defaults)
  })

  it('владелец персистится вместе с параметрами', () => {
    useCalculatorStore.getState().claimForUser(7)
    const raw = JSON.parse(localStorage.getItem('mortgage-calculator-params') ?? '{}')
    expect(raw.state.ownerUserId).toBe(7)
  })
})
