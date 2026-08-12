import { describe, it, expect, beforeEach } from 'vitest'
import { useCalculatorStore } from '../useCalculatorStore'

beforeEach(() => {
  localStorage.clear()
  useCalculatorStore.setState({ slipEnabled: false })
  useCalculatorStore.getState().setParam('slipMonth', 36)
})

describe('useCalculatorStore — тумблер слёта', () => {
  it('slipEnabled выключен по умолчанию', () => {
    expect(useCalculatorStore.getState().slipEnabled).toBe(false)
  })

  it('при slipEnabled=false result.slip === null независимо от params.slipMonth', () => {
    useCalculatorStore.getState().setParam('slipMonth', 36)
    expect(useCalculatorStore.getState().params.slipMonth).toBe(36)
    expect(useCalculatorStore.getState().result.slip).toBeNull()
  })

  it('effectiveSlipMonth() === 0 при выключенном тумблере', () => {
    expect(useCalculatorStore.getState().effectiveSlipMonth()).toBe(0)
  })

  it('после setSlipEnabled(true) result.slip !== null и effectiveSlipMonth === params.slipMonth', () => {
    useCalculatorStore.getState().setSlipEnabled(true)
    const state = useCalculatorStore.getState()
    expect(state.result.slip).not.toBeNull()
    expect(state.effectiveSlipMonth()).toBe(state.params.slipMonth)
  })

  it('выключение тумблера обратно возвращает result.slip в null, но params.slipMonth сохраняется', () => {
    useCalculatorStore.getState().setSlipEnabled(true)
    useCalculatorStore.getState().setSlipEnabled(false)
    const state = useCalculatorStore.getState()
    expect(state.result.slip).toBeNull()
    expect(state.params.slipMonth).toBe(36)
  })
})
