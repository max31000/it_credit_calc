import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mvv42/kit/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mvv42/kit/platform')>()),
  requestLogin: vi.fn(),
}))

import { requestLogin } from '@mvv42/kit/platform'
import { ApiError, apiClient } from '../client'

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(requestLogin).mockClear()
})

describe('apiClient (общий auth)', () => {
  it('ходит с cookie того же origin, без Bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, []))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.get('/mortgages')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.credentials).toBe('same-origin')
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('окончательный 401 (refresh не помог) — просит shell показать вход', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(String(input).includes('/auth/api/refresh') ? json(401, { error: 'no_session' }) : json(401, undefined)),
      ),
    )

    await expect(apiClient.get('/mortgages')).rejects.toMatchObject({ status: 401 })
    expect(requestLogin).toHaveBeenCalledWith('credit_calc')
  })

  it('403 — ApiError вызывающему коду, без запроса входа', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(403, { error: 'forbidden' })))

    const error = await apiClient.get('/mortgages').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
    expect(requestLogin).not.toHaveBeenCalled()
  })

  it('текст ошибки API доходит до уведомления', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { error: 'Ипотека не найдена' })))

    await expect(apiClient.get('/mortgages/1')).rejects.toThrow('Ипотека не найдена')
  })
})
