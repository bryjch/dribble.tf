import { useEffect, useState } from 'react'

import { useStore, type InterfaceLayout } from '@zus/store'

//
// ─── MOBILE LAYOUT ──────────────────────────────────────────────────────────────
//
// Whether the touch interface (Theater) replaces the desktop HUD: the `ui.layout` setting,
// Auto / Desktop / Touch. A phone held either way counts: a landscape phone is wider than
// useIsMobile's 768px, which used to hand it the desktop HUD.
//
// ?mobile in the URL sets Touch (to review it on a desktop); ?mobile=off sets Desktop. See
// getLayoutFromUrl.
//

/** Before the setting, ?mobile was remembered here (on | off). */
const LEGACY_STORAGE_KEY = 'dribble.mobileLayout'

/** The layout asked for by ?mobile, else by the old remembered flag (which is then dropped). */
export const getLayoutFromUrl = (): InterfaceLayout | null => {
  let legacy: string | null = null
  try {
    legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {}

  const param = new URLSearchParams(window.location.search).get('mobile')
  if (param !== null) return param === 'off' ? 'desktop' : 'touch'
  if (legacy === 'on') return 'touch'
  if (legacy === 'off') return 'desktop'
  return null
}

/**
 * Auto: a touch device decides by its screen, which rotating, Split View and Stage Manager do
 * not change, so the interface stays put: phones (short side under 600px) get Touch, tablets
 * Desktop. Without touch it is a computer, where a narrow window gets Touch.
 */
const autoIsTouch = () => {
  const touch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches
  if (touch) return Math.min(window.screen.width, window.screen.height) < 600
  return window.innerWidth < 768
}

export function useMobileLayout() {
  const layout = useStore(state => state.settings.ui.layout)
  const [auto, setAuto] = useState(autoIsTouch)
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight)

  useEffect(() => {
    const onResize = () => {
      setAuto(autoIsTouch())
      setLandscape(window.innerWidth > window.innerHeight)
    }
    // A touch screen can come and go without a resize (devtools' emulation).
    const pointer = window.matchMedia('(pointer: coarse)')
    window.addEventListener('resize', onResize)
    pointer.addEventListener('change', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      pointer.removeEventListener('change', onResize)
    }
  }, [])

  // Saved settings from before the setting have no layout: Auto.
  return { active: layout === 'touch' || (layout !== 'desktop' && auto), landscape }
}
