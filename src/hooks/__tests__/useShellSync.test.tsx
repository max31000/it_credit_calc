import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useShellSync } from '../useShellSync'

function Probe() {
  useShellSync('credit_calc')
  return null
}

describe('useShellSync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('не шлёт сообщений в standalone-режиме', () => {
    const spy = vi.spyOn(window.parent, 'postMessage')
    render(
      <MemoryRouter initialEntries={['/tracker']}>
        <Probe />
      </MemoryRouter>,
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('в iframe шлёт NAVIGATE с путём относительно basename и targetOrigin = location.origin', () => {
    const postMessage = vi.fn()
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
    vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage } as unknown as Window)

    render(
      <MemoryRouter initialEntries={['/tracker/42?tab=plan#x']}>
        <Probe />
      </MemoryRouter>,
    )

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'NAVIGATE', serviceId: 'credit_calc', path: '/tracker/42?tab=plan#x' },
      window.location.origin,
    )
  })
})
