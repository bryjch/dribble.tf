import { useRef, useState, useEffect, useLayoutEffect } from 'react'

/**
 * Hook for easily adding element event listeners which will gracefully cleanup
 * itself when necessary and also update itself if {handler} dependencies change
 *
 * Reference: https://usehooks.com/useEventListener/
 */
export function useEventListener(
  eventName: string,
  handler: (...args: any[]) => any,
  element: HTMLElement | (Window & typeof globalThis) = window
) {
  // Create a ref that stores handler
  const savedHandler = useRef<any>()

  // Update ref.current value if handler changes.
  // This allows our effect below to always get latest handler
  // without us needing to pass it in effect deps array
  // and potentially cause effect to re-run every render
  useEffect(() => {
    savedHandler.current = handler
  }, [handler])

  useEffect(
    () => {
      // Make sure element supports addEventListener
      const isSupported = element && element.addEventListener
      if (!isSupported) return

      // Create event listener that calls handler function stored in ref
      const eventListener = (event: any) => savedHandler.current(event)

      // Add event listener
      element.addEventListener(eventName, eventListener)

      // Remove event listener on cleanup
      return () => {
        element.removeEventListener(eventName, eventListener)
      }
    },
    [eventName, element] // Re-run if eventName or element changes
  )
}

export function useAnimationFrame(callback: (deltaTime: number) => any) {
  // Use useRef for mutable variables that we want to persist
  // without triggering a re-render on their change
  const requestRef = useRef<number>(0)
  const previousTimeRef = useRef<number>(0)

  const animate = (time: number) => {
    if (previousTimeRef.current != undefined) {
      const deltaTime = time - previousTimeRef.current
      callback(deltaTime)
    }
    previousTimeRef.current = time
    requestRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(requestRef.current)
  }, []) // Make sure the effect runs only once
}
