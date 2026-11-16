import { useLayoutEffect, useRef, useState } from 'react'

//
// ─── AUTO HEIGHT ────────────────────────────────────────────────────────────────
//
// Eases its height to its content's whenever the content changes size (a panel switching tabs,
// a setting unfolding its options), so the panel around it grows and shrinks smoothly instead
// of jumping. The first size is taken as is. Styled by .ui-auto-height in src/theme/base.css.
//

export const AutoHeight = ({ children }: { children: React.ReactNode }) => {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [animating, setAnimating] = useState(false)

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? inner.offsetHeight)
      setHeight(previous => {
        if (previous !== null && previous !== next) setAnimating(true)
        return next
      })
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className="ui-auto-height"
      data-animating={animating ? 'true' : undefined}
      style={height === null ? undefined : { height }}
      onTransitionEnd={event => event.target === event.currentTarget && setAnimating(false)}
    >
      <div ref={innerRef} className="ui-auto-height__inner">
        {children}
      </div>
    </div>
  )
}
