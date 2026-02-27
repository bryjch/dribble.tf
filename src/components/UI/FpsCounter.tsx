import { useFrame } from '@react-three/fiber'
import { useRef, RefObject } from 'react'
import { createPortal } from 'react-dom'

interface FpsCounterProps {
  parent: RefObject<HTMLDivElement | null>
}

export function FpsCounter({ parent }: FpsCounterProps) {
  const textRef = useRef<HTMLDivElement>(null)
  const framesRef = useRef(0)
  const lastTimeRef = useRef(performance.now())

  useFrame(() => {
    framesRef.current++
    const now = performance.now()
    if (now - lastTimeRef.current >= 1000) {
      if (textRef.current) {
        textRef.current.textContent = `${framesRef.current} FPS`
      }
      framesRef.current = 0
      lastTimeRef.current = now
    }
  })

  if (!parent.current) return null

  return createPortal(
    <div
      ref={textRef}
      className="fixed bottom-0 right-0 bg-black/50 px-2 py-1 font-mono text-xs text-white"
    >
      0 FPS
    </div>,
    parent.current
  )
}
