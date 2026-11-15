import { useEffect, useSyncExternalStore } from 'react'
import { motion } from 'framer-motion'

import {
  UrlDemoStatus,
  clearNotice,
  getUrlDemoStatus,
  subscribeToUrlDemoStatus,
} from '@utils/notice'

/**
 * The status line for getting a match on screen (see @utils/notice): a demo being looked up,
 * a live match connecting, or what went wrong. Errors and notices can always be dismissed,
 * with the close button or Escape.
 */
// useSyncExternalStore, not useState + useEffect: a status set between the first render and
// the subscription (a fast failure right after load) would otherwise never show.
const subscribe = (onChange: () => void) => {
  const unsubscribe = subscribeToUrlDemoStatus(onChange)
  return () => {
    unsubscribe()
  }
}

export const useUrlDemoStatus = (): UrlDemoStatus =>
  useSyncExternalStore(subscribe, getUrlDemoStatus)

export const UrlDemoNotice = () => {
  const status = useUrlDemoStatus()
  const dismissible = status.state === 'error' || status.state === 'notice'

  useEffect(() => {
    if (!dismissible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearNotice()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismissible])

  if (status.state === 'idle') return null

  return (
    <div className="ui-layer top-20 items-start justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="ui-toast ui-notice"
        data-state={status.state}
        role={status.state === 'error' ? 'alert' : 'status'}
      >
        <div className="ui-notice__body">
          {status.state === 'resolving' && <div>{status.message ?? 'Looking up demo…'}</div>}

          {status.state === 'notice' && <div className="text-sm">{status.message}</div>}

          {status.state === 'error' && (
            <>
              <div className="ui-notice__title">{status.title ?? "Couldn't load this demo"}</div>
              <div className="ui-notice__message">{status.message}</div>
              {status.link && (
                <a
                  href={status.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-link mt-2 inline-block text-sm"
                >
                  {status.link.label}
                </a>
              )}
            </>
          )}
        </div>

        {dismissible && (
          <button type="button" className="ui-close-btn ui-notice__close" onClick={clearNotice} aria-label="Dismiss">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </motion.div>
    </div>
  )
}
