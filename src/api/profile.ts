import { apiClient } from './client'
import type { AccountSettings, UserSettingsResponse } from './types'

export const getSettings = () => apiClient.get<UserSettingsResponse>('/profile/settings')

/** PUT — полная замена (не merge), поэтому всегда отправляем весь набор. Версия контракта — 1. */
export const putSettings = (settings: AccountSettings) =>
  apiClient.put<UserSettingsResponse>('/profile/settings', { version: 1, settings })
