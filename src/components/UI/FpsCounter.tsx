import { useRef, useEffect } from 'react'

export function FpsCounter() {
  const textRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frames = 0
    let lastTime = performance.now()
    let rafId: number

    const tick = () => {
      frames++
      const now = performance.now()
      if (now - lastTime >= 1000) {
        if (textRef.current) {
          textRef.current.textContent = `${frames} FPS`
        }
        frames = 0
        lastTime = now
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div
      ref={textRef}
      className="fixed bottom-0 right-0 bg-black/50 px-2 py-1 font-mono text-xs text-white"
    >
      0 FPS
    </div>
  )
}
