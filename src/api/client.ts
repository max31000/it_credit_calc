import { useAuthStore } from '../store/useAuthStore'
import { useCalculatorStore } from '../store/useCalculatorStore'

/**
 * Пусто на GitHub Pages (сборка без VITE_API_BASE) — трекер там полностью скрыт,
 * см. §6 спеки. На VDS — `/credit_calc/api`, проксируется nginx-ом фронт-контейнера.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
export const TRACKER_ENABLED = API_BASE !== ''

/** Ошибка ответа API с HTTP-статусом — позволяет вызывающему коду отличать
 *  «неавторизован» (401) от прочих ошибок (в т.ч. сетевых, у которых status нет). */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options?.headers ?? {}),
    },
  })

  if (res.status === 401) {
    // Токен истёк или невалиден — разлогиниваем и уводим на экран входа.
    // exitMortgageMode() — как в Header.handleLogout (G4): без него баннер режима
    // ипотеки пережил бы жёсткий редирект (persisted linkedMortgage) и показался бы
    // разлогиненному гостю или следующему пользователю на этом устройстве.
    useCalculatorStore.getState().exitMortgageMode()
    useAuthStore.getState().logout()
    window.location.href = `${import.meta.env.BASE_URL ?? '/'}login`
    throw new ApiError('Требуется авторизация', 401)
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError((error as { error?: string }).error ?? `HTTP ${res.status}`, res.status)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
