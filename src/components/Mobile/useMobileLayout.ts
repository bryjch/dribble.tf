import { useEffect, useState } from 'react'

//
// ─── MOBILE LAYOUT ──────────────────────────────────────────────────────────────
//
// Whether the phone interface replaces the desktop HUD. A phone held either way counts: a
// landscape phone is wider than useIsMobile's 768px, which used to hand it the desktop HUD.
//
// ?mobile in the URL turns it on at any size (to review it on a desktop); ?mobile=off keeps the
// desktop HUD on a phone. Either is remembered.
//

const STORAGE_KEY = 'dribble.mobileLayout'

type Preference = 'on' | 'off' | 'auto'

const readPreference = (): Preference => {
  const param = new URLSearchParams(window.location.search).get('mobile')
  if (param !== null) {
    const preference: Preference = param === 'off' ? 'off' : 'on'
    try {
      localStorage.setItem(STORAGE_KEY, preference)
    } catch {}
    return preference
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'on' || saved === 'off') return saved
  } catch {}
  return 'auto'
}

const PREFERENCE = readPreference()

/** A phone: narrow, or a touch screen that is short (a phone held sideways). */
const isPhoneViewport = () => {
  if (PREFERENCE !== 'auto') return PREFERENCE === 'on'
  const coarse = window.matchMedia('(pointer: coarse)').matches
  return (
    window.innerWidth < 768 || (coarse && Math.min(window.innerWidth, window.innerHeight) < 600)
  )
}

export function useMobileLayout() {
  const [phone, setPhone] = useState(isPhoneViewport)
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight)

  useEffect(() => {
    const onResize = () => {
      setPhone(isPhoneViewport())
      setLandscape(window.innerWidth > window.innerHeight)
    }
    // A touch screen can come and go without a resize (a tablet's keyboard, devtools' emulation).
    const pointer = window.matchMedia('(pointer: coarse)')
    window.addEventListener('resize', onResize)
    pointer.addEventListener('change', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      pointer.removeEventListener('change', onResize)
    }
  }, [])

  return { active: phone, landscape }
}
