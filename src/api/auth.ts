import { API_BASE, ApiError } from './client'
import type { AuthResponse, AuthUser } from './types'

/** Поля, которые отдаёт Telegram Login Widget колбэку (snake_case) */
export interface TelegramAuthData {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export async function loginWithTelegram(data: TelegramAuthData): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      username: data.username,
      photoUrl: data.photo_url,
      authDate: data.auth_date,
      hash: data.hash,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Ошибка авторизации' }))
    throw new Error((err as { error?: string }).error ?? 'Ошибка авторизации')
  }

  return res.json()
}

export async function fetchMe(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    throw new ApiError('Сессия недействительна', res.status)
  }

  return res.json()
}
