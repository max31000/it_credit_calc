import { useMe, type MeStatus, type Mvv42User } from '@mvv42/kit/platform'
import { SERVICE_ID, TRACKER_ENABLED } from '../api/client'

export interface TrackerUser {
  /** Пользователь, которому доступен трекер (вошёл и есть доступ к credit_calc); иначе `null`. */
  user: Mvv42User | null
  /** Статус `/auth/api/me`: `unavailable` — auth не ответил (не путать с «аноним»). */
  status: MeStatus
}

/** Кто может пользоваться серверной частью (трекер, настройки аккаунта). Без VITE_API_BASE — никто. */
export function useTrackerUser(): TrackerUser {
  const { user, status, app } = useMe()
  const granted = TRACKER_ENABLED && user !== null && (app(SERVICE_ID)?.granted ?? false)
  return { user: granted ? user : null, status }
}
