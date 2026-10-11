import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Уведомляет portal-shell о навигации внутри сервиса через postMessage
 * ({ type: 'NAVIGATE', serviceId, path }). path — относительно basename роутера
 * (useLocation его уже срезает). targetOrigin = location.origin: shell и сервис
 * живут на одном origin. В standalone-режиме (window.self === window.top) ничего не шлёт.
 */
export function useShellSync(serviceId: string) {
  const location = useLocation()

  useEffect(() => {
    if (window.self === window.top) return

    window.parent.postMessage(
      {
        type: 'NAVIGATE',
        serviceId,
        path: location.pathname + location.search + location.hash,
      },
      window.location.origin,
    )
  }, [location, serviceId])
}
