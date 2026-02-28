import { useMemo } from 'react'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { ChatEntry } from '@components/Analyse/Data/Types'

const HUD_CHAT_TIME_SECONDS = 12
const HUD_CHAT_FADE_SECONDS = 2
const HUD_CHAT_MAX_LINES = 8

const Tf2Colors = {
  normal: { r: 255, g: 178, b: 0, a: 1 },
  grey: { r: 204, g: 204, b: 204, a: 1 },
  red: { r: 255, g: 63, b: 63, a: 1 },
  blue: { r: 153, g: 204, b: 255, a: 1 },
  location: { r: 64, g: 255, b: 64, a: 1 },
  achievement: { r: 153, g: 255, b: 153, a: 1 },
} as const

type RGBA = { r: number; g: number; b: number; a: number }

const toCssColor = (c: RGBA) => {
  if (c.a >= 0.999) {
    return `rgb(${c.r} ${c.g} ${c.b})`
  }
  return `rgb(${c.r} ${c.g} ${c.b} / ${c.a})`
}

const parseHex = (hex: string) => {
  const normalized = hex.trim()
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    return null
  }
  return parseInt(normalized, 16)
}

const parseHexColor = (hex: string): RGBA | null => {
  const raw = hex.trim()
  if (raw.length !== 6 && raw.length !== 8) {
    return null
  }

  const r = parseHex(raw.slice(0, 2))
  const g = parseHex(raw.slice(2, 4))
  const b = parseHex(raw.slice(4, 6))
  if (r === null || g === null || b === null) {
    return null
  }

  let a = 1
  if (raw.length === 8) {
    const alpha = parseHex(raw.slice(6, 8))
    if (alpha === null) {
      return null
    }
    a = Math.max(0, Math.min(1, alpha / 255))
  }

  return { r, g, b, a }
}

const getPlayerNameColor = (
  parser: AsyncParser,
  playerId: number | null | undefined,
  tick: number
): RGBA => {
  if (playerId === null || playerId === undefined) {
    return Tf2Colors.grey
  }

  const meta = parser.playerCache?.metaCache?.getMeta?.(playerId, tick)
  switch (meta?.teamId) {
    case 2:
      return Tf2Colors.red
    case 3:
      return Tf2Colors.blue
    default:
      return Tf2Colors.grey
  }
}

type Segment = { text: string; color: string }

const parseTf2ColorMarkup = (rawText: string, playerNameColor: RGBA): Segment[] => {
  // Valve SDK: hud_basechat.h (TextColor)
  // 1 normal, 2 old colors, 3 player name, 4 location, 5 achievement, 6 custom, 7 hex rgb, 8 hex rgba
  let currentColor: RGBA = Tf2Colors.normal
  let lastCustomColor: RGBA = Tf2Colors.normal

  const out: Segment[] = []
  let buf = ''

  const flush = () => {
    if (!buf) return
    out.push({ text: buf, color: toCssColor(currentColor) })
    buf = ''
  }

  for (let i = 0; i < rawText.length; i++) {
    const code = rawText.charCodeAt(i)
    if (code > 0 && code < 10) {
      flush()
      switch (code) {
        case 1: // normal
        case 2: // old colors
          currentColor = Tf2Colors.normal
          break
        case 3: // player name
          currentColor = playerNameColor
          break
        case 4: // location
          currentColor = Tf2Colors.location
          break
        case 5: // achievement
          currentColor = Tf2Colors.achievement
          break
        case 6: // custom
          currentColor = lastCustomColor
          break
        case 7: {
          const hex = rawText.slice(i + 1, i + 7)
          const parsed = parseHexColor(hex)
          if (parsed) {
            currentColor = parsed
            lastCustomColor = parsed
            i += 6
          }
          break
        }
        case 8:
        // Some servers use 9 for RGBA even though Valve uses 8.
        // eslint-disable-next-line no-fallthrough
        case 9: {
          const hex = rawText.slice(i + 1, i + 9)
          const parsed = parseHexColor(hex)
          if (parsed) {
            currentColor = parsed
            lastCustomColor = parsed
            i += 8
          }
          break
        }
      }
      continue
    }

    buf += rawText[i]
  }

  flush()
  return out
}

const getVisibleChat = (chat: ChatEntry[], tick: number, intervalPerTick: number): ChatEntry[] => {
  if (!chat.length) {
    return []
  }

  const maxAgeTicks = Math.ceil(HUD_CHAT_TIME_SECONDS / intervalPerTick)
  const minTick = Math.max(0, tick - maxAgeTicks)

  const visible: ChatEntry[] = []
  for (let i = chat.length - 1; i >= 0; i--) {
    const entry = chat[i]
    if (entry.tick > tick) {
      continue
    }
    if (entry.tick < minTick) {
      break
    }
    visible.push(entry)
    if (visible.length >= HUD_CHAT_MAX_LINES) {
      break
    }
  }

  visible.reverse()
  return visible
}

export interface ChatHudProps {
  parser: AsyncParser
  tick: number
}

export const ChatHud = (props: ChatHudProps) => {
  const { parser, tick } = props

  const intervalPerTick = parser.intervalPerTick ?? 0.015
  const visible = useMemo(
    () => getVisibleChat(parser.chat ?? [], tick, intervalPerTick),
    [parser, tick, intervalPerTick]
  )

  if (!visible.length) {
    return null
  }

  return (
    <div className="text-outline pointer-events-none max-w-[46rem] select-none space-y-1">
      {visible.map((entry, idx) => {
        const ageSeconds = Math.max(0, (tick - entry.tick) * intervalPerTick)
        const fadeStart = HUD_CHAT_TIME_SECONDS - HUD_CHAT_FADE_SECONDS
        const opacity =
          ageSeconds <= fadeStart
            ? 1
            : Math.max(0, Math.min(1, (HUD_CHAT_TIME_SECONDS - ageSeconds) / HUD_CHAT_FADE_SECONDS))

        const nameColor = getPlayerNameColor(parser, entry.clientPlayerId, entry.tick)
        const segments = parseTf2ColorMarkup(entry.rawText, nameColor)

        return (
          <div
            key={`chat-${entry.tick}-${idx}`}
            className="leading-snug"
            style={{ opacity, transition: 'opacity 120ms linear' }}
          >
            <span className="whitespace-pre-wrap">
              {segments.map((seg, segIdx) => (
                <span key={segIdx} style={{ color: seg.color }}>
                  {seg.text}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}
