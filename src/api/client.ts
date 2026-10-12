import { ApiError, apiJson, requestLogin } from '@mvv42/kit/platform'

export { ApiError }

/** id сервиса в mvv42 (auth registry, shell, `Mvv42Provider`). */
export const SERVICE_ID = 'credit_calc'

/**
 * Пусто на GitHub Pages/Vercel (сборка без VITE_API_BASE) — трекер там полностью скрыт,
 * см. §6 спеки. На VDS — `/credit_calc/api` (относительный путь того же origin: cookie общего
 * auth уходят сами), проксируется nginx-ом фронт-контейнера.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
export const TRACKER_ENABLED = API_BASE !== ''

/**
 * JSON-запрос к API трекера через `apiJson` кита: cookie общего auth, 401 → один refresh → повтор.
 * Окончательный 401 (сессии нет) — просим shell показать вход; 403 и прочие ошибки — `ApiError`
 * вызывающему коду (экраны показывают `ErrorState`, мутации — уведомление).
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await apiJson<T>(`${API_BASE}${path}`, init)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) requestLogin(SERVICE_ID)
    throw e
  }
}

const withBody = (method: string, body: unknown): RequestInit => ({
  method,
  body: body !== undefined ? JSON.stringify(body) : undefined,
})

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, withBody('POST', body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, withBody('PUT', body)),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
