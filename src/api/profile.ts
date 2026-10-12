import { apiClient } from './client'
import type { AccountSettings, UserSettingsResponse } from './types'

/** Фоновая синхронизация: 401 не уводит на вход (см. `RequestOptions.background`). */
export const getSettings = () => apiClient.get<UserSettingsResponse>('/profile/settings', { background: true })

/** PUT — полная замена (не merge), поэтому всегда отправляем весь набор.
 *  Версия контракта — 2 (седьмое поле startingSavings, §7.1 дизайна таймлайна). */
export const putSettings = (settings: AccountSettings) =>
  apiClient.put<UserSettingsResponse>('/profile/settings', { version: 2, settings }, { background: true })
