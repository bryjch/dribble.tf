import { useEffect, useState } from 'react'
import '@react-three/fiber'

import { getMapConversionUrl } from '@utils/game'

type LightingProfile = {
  ambientColor: string
  ambientIntensity: number
  keyColor: string
  keyIntensity: number
  keyDirection: [number, number, number]
  fillColor: string
  fillIntensity: number
  fillDirection: [number, number, number]
}

type VmfLightEnvironment = {
  ambient?: {
    color?: number[]
    brightness?: number | null
  } | null
  sun?: {
    color?: number[]
    brightness?: number | null
  } | null
}

const DEFAULT_LIGHTING: LightingProfile = {
  ambientColor: '#ffffff',
  ambientIntensity: 0.3,
  keyColor: '#ffffff',
  keyIntensity: 1.5,
  keyDirection: [100, 100, 100],
  fillColor: '#ffffff',
  fillIntensity: 1.5,
  fillDirection: [-100, -100, 100],
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const blendWithWhite = (color: number[] | undefined, keepOriginal: number): number[] | undefined => {
  if (!Array.isArray(color) || color.length < 3) return undefined
  const keep = clamp(keepOriginal, 0, 1)
  const mix = (channel: number) => {
    const clamped = clamp(Math.round(Number(channel) || 0), 0, 255)
    return Math.round(clamped * keep + 255 * (1 - keep))
  }
  return [mix(color[0]), mix(color[1]), mix(color[2])]
}

const toCssColor = (color: number[] | undefined, fallback: string): string => {
  if (!Array.isArray(color) || color.length < 3) return fallback
  const r = clamp(Math.round(Number(color[0]) || 0), 0, 255)
  const g = clamp(Math.round(Number(color[1]) || 0), 0, 255)
  const b = clamp(Math.round(Number(color[2]) || 0), 0, 255)
  return `rgb(${r}, ${g}, ${b})`
}

const deriveLightingProfile = (
  environment: VmfLightEnvironment | null | undefined
): LightingProfile => {
  if (!environment) return DEFAULT_LIGHTING

  const ambientBrightness = Number(environment.ambient?.brightness)
  const sunBrightness = Number(environment.sun?.brightness)

  const ambientIntensity = Number.isFinite(ambientBrightness)
    ? clamp(ambientBrightness / 20, 0.1, 0.8)
    : DEFAULT_LIGHTING.ambientIntensity

  const keyIntensity = Number.isFinite(sunBrightness)
    ? clamp(sunBrightness / 30, 0.3, 3.0)
    : DEFAULT_LIGHTING.keyIntensity

  const fillIntensity = clamp(keyIntensity * 0.5, 0.2, 2.0)

  return {
    ambientColor: toCssColor(
      blendWithWhite(environment.ambient?.color, 0.4),
      DEFAULT_LIGHTING.ambientColor
    ),
    ambientIntensity,
    keyColor: toCssColor(
      blendWithWhite(environment.sun?.color, 0.45),
      DEFAULT_LIGHTING.keyColor
    ),
    keyIntensity,
    keyDirection: DEFAULT_LIGHTING.keyDirection,
    fillColor: toCssColor(
      blendWithWhite(environment.ambient?.color, 0.35),
      DEFAULT_LIGHTING.fillColor
    ),
    fillIntensity,
    fillDirection: DEFAULT_LIGHTING.fillDirection,
  }
}

export const Lights = ({ map }: { map?: string }) => {
  const [profile, setProfile] = useState<LightingProfile>(DEFAULT_LIGHTING)

  useEffect(() => {
    setProfile(DEFAULT_LIGHTING)

    const conversionUrl = getMapConversionUrl(map || '')
    if (!conversionUrl) return

    let cancelled = false

    fetch(conversionUrl)
      .then(response => {
        if (!response.ok) throw new Error(`${response.status}`)
        return response.json()
      })
      .then(meta => {
        if (!cancelled) {
          setProfile(deriveLightingProfile(meta?.lightEnvironment))
        }
      })
      .catch(() => {
        if (!cancelled) setProfile(DEFAULT_LIGHTING)
      })

    return () => {
      cancelled = true
    }
  }, [map])

  return (
    <group name="lights">
      <ambientLight color={profile.ambientColor} intensity={profile.ambientIntensity} />
      <directionalLight
        color={profile.keyColor}
        intensity={profile.keyIntensity}
        position={profile.keyDirection}
      />
      <directionalLight
        color={profile.fillColor}
        intensity={profile.fillIntensity}
        position={profile.fillDirection}
      />
    </group>
  )
}
