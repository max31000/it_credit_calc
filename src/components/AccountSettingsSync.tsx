import { useEffect, useRef } from 'react'
import { notifications } from '@mantine/notifications'
import { useTrackerUser } from '../hooks/useTrackerUser'
import { useCalculatorStore, ACCOUNT_SETTING_KEYS } from '../store/useCalculatorStore'
import { getSettings, putSettings } from '../api/profile'
import { accountSettingsFromParams } from '../lib/mortgageToParams'
import type { AccountSettings } from '../api/types'

const DEBOUNCE_MS = 800
const GET_RETRY_MS = 5000
const PUT_RETRY_MS = 3000

function accountSettingsEqual(a: AccountSettings, b: AccountSettings): boolean {
  return ACCOUNT_SETTING_KEYS.every((k) => a[k] === b[k])
}

/**
 * Синхронизация полей аккаунта из `ACCOUNT_SETTING_KEYS` (С3, §5.3 спеки
 * docs/specs/2026-08-12-tracker-ux-design.md; §2.6 дизайна таймлайна добавил седьмое —
 * `startingSavings`)
 * с сервером. Компонент без разметки — монтируется в `App` (`src/App.tsx`).
 *
 * Пользователь — из общего auth (`useMe().user` кита, ключ — `user.id`). Работает только для
 * вошедшего пользователя с доступом к сервису и при `TRACKER_ENABLED` (иначе — ни одного запроса, G12).
 * При смене `user.id`: GET → `settings === null` сеет PUT из ownParams, иначе сервер побеждает
 * (applyAccountSettings). При изменении любого из этих полей — дебаунс 800 мс → PUT.
 *
 * Выход (в shell, в другой вкладке или через меню аккаунта) — `user` становится `null`: режим
 * ипотеки сбрасывается, чтобы гость или следующий пользователь не увидел чужую ипотеку (G4).
 */
export function AccountSettingsSync() {
  const { user, status } = useTrackerUser()
  const userId = user?.id ?? null
  const exitMortgageMode = useCalculatorStore((s) => s.exitMortgageMode)
  const applyAccountSettings = useCalculatorStore((s) => s.applyAccountSettings)
  const hasLinkedMortgage = useCalculatorStore((s) => s.linkedMortgage !== null)

  const active = userId !== null

  // Достоверно известно, что пользователя нет (аноним / нет доступа), а режим ипотеки остался
  // в персисте от прошлой сессии — выходим из него. При недоступном auth (`unavailable`) и во время
  // загрузки ничего не трогаем: временный сбой не должен выкидывать из режима ипотеки.
  useEffect(() => {
    if (userId === null && hasLinkedMortgage && (status === 'anonymous' || status === 'authenticated')) {
      exitMortgageMode()
    }
  }, [userId, status, hasLinkedMortgage, exitMortgageMode])

  const loadedRef = useRef(false)
  const lastUserIdRef = useRef<number | null>(null)
  const notifiedRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Последний набор, про который мы знаем, что он совпадает с сервером. Общий для обоих
  // эффектов: GET проставляет его ДО applyAccountSettings, поэтому подписка не отправляет
  // обратно PUT с только что полученными значениями.
  const lastSyncedRef = useRef<AccountSettings | null>(null)

  // Инициализация/смена пользователя: GET → засеять сервер локальными значениями
  // (первый вход) или применить настройки сервера (сервер побеждает).
  useEffect(() => {
    if (!active || userId === null) {
      lastUserIdRef.current = null
      loadedRef.current = false
      return
    }
    if (lastUserIdRef.current === userId) return

    if (lastUserIdRef.current !== null) {
      // Смена пользователя внутри активной сессии — не показываем чужую ипотеку (G4).
      exitMortgageMode()
    }
    // Персист принадлежал другому пользователю (вход B после A на том же устройстве) — сбрасываем
    // режим ипотеки и параметры ДО GET/посева: параметры A не должны уехать PUT-ом в аккаунт B.
    useCalculatorStore.getState().claimForUser(userId)
    lastUserIdRef.current = userId
    loadedRef.current = false
    notifiedRef.current = false
    lastSyncedRef.current = null

    // Актуальность ответа/повтора проверяем по «мы всё ещё тот же залогиненный пользователь»,
    // а не флагом на замыкание эффекта: при разлогине первый эффект обнуляет lastUserIdRef,
    // и отложенный GET не уедет без сессии (иначе 401 запросил бы вход, см. api/client.ts). Отмена по флагу здесь была бы неверной — StrictMode в dev
    // прогоняет эффект дважды, и второй прогон уходит в ранний return выше.
    const isStale = () => lastUserIdRef.current !== userId

    const load = (retry: boolean) => {
      getSettings()
        .then((res) => {
          if (isStale()) return
          loadedRef.current = true
          if (res.settings === null) {
            const own = accountSettingsFromParams(useCalculatorStore.getState().ownParams)
            lastSyncedRef.current = own
            putSettings(own).catch(() => {
              // первичный посев необязателен к успеху — следующий debounced PUT попробует снова
            })
          } else {
            // Порядок важен: сначала фиксируем «это уже на сервере», иначе подписка
            // среагирует на applyAccountSettings и отправит те же значения обратно.
            lastSyncedRef.current = res.settings
            applyAccountSettings(res.settings)
          }
        })
        .catch(() => {
          if (isStale() || !retry) return
          setTimeout(() => {
            if (!isStale()) load(false)
          }, GET_RETRY_MS)
        })
    }
    load(true)
  }, [active, userId, exitMortgageMode, applyAccountSettings])

  // Подписка на изменения шести полей аккаунта → дебаунс → PUT
  useEffect(() => {
    if (!active) return undefined

    // lastUserIdRef === null — пользователь уже вышел: отложенный PUT ушёл бы без сессии
    // и получил бы 401 с запросом входа.
    const sendWithRetry = (settings: AccountSettings, retry: boolean) => {
      if (lastUserIdRef.current === null) return
      putSettings(settings).catch(() => {
        if (retry) {
          setTimeout(() => sendWithRetry(settings, false), PUT_RETRY_MS)
        } else if (!notifiedRef.current) {
          notifiedRef.current = true
          notifications.show({
            title: 'Ошибка',
            message: 'Не удалось сохранить настройки',
            color: 'red',
          })
        }
      })
    }

    const unsubscribe = useCalculatorStore.subscribe((state) => {
      if (!loadedRef.current) return
      // Источник — ownParams, а не params: в режиме ипотеки params содержат производные
      // от ипотеки значения (в частности horizonYears = min(настройка, срок ипотеки)),
      // и подписка на params уехала бы на сервер, перетерев настройку аккаунта.
      // Правки шести полей попадают в ownParams всегда — так устроен setParam (§3.1 спеки).
      const next = accountSettingsFromParams(state.ownParams)
      if (lastSyncedRef.current !== null && accountSettingsEqual(lastSyncedRef.current, next)) return
      lastSyncedRef.current = next

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        sendWithRetry(next, true)
      }, DEBOUNCE_MS)
    })

    return () => {
      unsubscribe()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [active])

  return null
}
