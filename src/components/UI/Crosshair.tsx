import { useStore } from '@zus/store'
import { CrosshairStyle } from '@constants/types'

const CrosshairSVG = ({ style, size, color }: { style: CrosshairStyle; size: number; color: string }) => {
  const half = size / 2

  switch (style) {
    case 'crosshair': {
      // 4 lines with center gap
      const gap = size * 0.15
      const lineWidth = Math.max(1.5, size * 0.07)
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
          {/* Top */}
          <line x1={half} y1={0} x2={half} y2={half - gap} stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
          {/* Bottom */}
          <line x1={half} y1={half + gap} x2={half} y2={size} stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
          {/* Left */}
          <line x1={0} y1={half} x2={half - gap} y2={half} stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
          {/* Right */}
          <line x1={half + gap} y1={half} x2={size} y2={half} stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
        </svg>
      )
    }

    case 'cross': {
      // Solid plus sign (no gap)
      const lineWidth = Math.max(2, size * 0.1)
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
          <line x1={half} y1={0} x2={half} y2={size} stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
          <line x1={0} y1={half} x2={size} y2={half} stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
        </svg>
      )
    }

    case 'circle': {
      // Open circle ring
      const radius = half * 0.7
      const lineWidth = Math.max(1.5, size * 0.07)
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
          <circle cx={half} cy={half} r={radius} fill="none" stroke={color} strokeWidth={lineWidth} />
        </svg>
      )
    }

    case 'dot': {
      // Small solid filled circle
      const radius = half * 0.35
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
          <circle cx={half} cy={half} r={radius} fill={color} />
        </svg>
      )
    }

    default:
      return null
  }
}

export const Crosshair = () => {
  const crosshair = useStore(state => state.settings.ui.crosshair)
  const controlsMode = useStore(state => state.scene.controls.mode)

  if (controlsMode !== 'pov' || crosshair.style === 'none') return null

  return (
    <div
      style={{ opacity: crosshair.opacity, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}
    >
      <CrosshairSVG style={crosshair.style} size={crosshair.size} color={crosshair.color} />
    </div>
  )
}
