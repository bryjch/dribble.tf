import { useMemo } from 'react'
import { isMobile } from 'react-device-detect'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { ChatEntry } from '@components/Analyse/Data/Types'
import { useStore } from '@zus/store'

const HUD_CHAT_TIME_SECONDS = 12
const HUD_CHAT_FADE_SECONDS = 2
const HUD_CHAT_MAX_LINES = 8

// TF2's chat colours (hud_basechat.h) are tokens (--ui-chat-*, tokens.css) so a theme can
// retint them; colours a server sends as hex are drawn as sent.
const ChatColors = {
  normal: 'rgb(var(--ui-chat-normal))',
  grey: 'rgb(var(--ui-chat-name))',
  red: 'rgb(var(--ui-chat-name-red))',
  blue: 'rgb(var(--ui-chat-name-blu))',
  location: 'rgb(var(--ui-chat-location))',
  achievement: 'rgb(var(--ui-chat-achievement))',
} as const

type RGBA = { r: number; g: number; b: number; a: number }

const toCssColor = (c: RGBA) => {
  if (c.a >= 0.999) {
    return `rgb(${c.r} ${c.g} ${c.b})`
  }
  return `rgb(${c.r} ${c.g} ${c.b} / ${c.a})`
}

/** Who could see a message, as TF2 prefixes it. */
const CHAT_PREFIX = /^(\*DEAD\*\s?\(TEAM\)|\*DEAD\*|\*SPEC\*|\*COACH\*|\(TEAM\))\s*/

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
  parser: MatchSource,
  playerId: number | null | undefined,
  tick: number
): string => {
  if (playerId === null || playerId === undefined) {
    return ChatColors.grey
  }

  const teamId = parser.slotTeamAt(playerId, tick)
  switch (teamId) {
    case 2:
      return ChatColors.red
    case 3:
      return ChatColors.blue
    default:
      return ChatColors.grey
  }
}

type Segment = { text: string; color: string; kind?: 'name' | 'prefix' }

const parseTf2ColorMarkup = (rawText: string, playerNameColor: string): Segment[] => {
  // Valve SDK: hud_basechat.h (TextColor)
  // 1 normal, 2 old colors, 3 player name, 4 location, 5 achievement, 6 custom, 7 hex rgb, 8 hex rgba
  let currentColor: string = ChatColors.normal
  let lastCustomColor: string = ChatColors.normal

  const out: Segment[] = []
  let buf = ''

  const flush = () => {
    if (!buf) return
    const kind = currentColor === playerNameColor ? 'name' : undefined
    // The visibility prefix leads the first segment, before the name.
    const prefix = !out.length && !kind ? buf.match(CHAT_PREFIX) : null
    if (prefix) {
      out.push({ text: prefix[1], color: currentColor, kind: 'prefix' })
      buf = buf.slice(prefix[0].length)
      if (!buf) return
    }
    out.push({ text: buf, color: currentColor, kind })
    buf = ''
  }

  for (let i = 0; i < rawText.length; i++) {
    const code = rawText.charCodeAt(i)
    if (code > 0 && code < 10) {
      flush()
      switch (code) {
        case 1: // normal
        case 2: // old colors
          currentColor = ChatColors.normal
          break
        case 3: // player name
          currentColor = playerNameColor
          break
        case 4: // location
          currentColor = ChatColors.location
          break
        case 5: // achievement
          currentColor = ChatColors.achievement
          break
        case 6: // custom
          currentColor = lastCustomColor
          break
        case 7: {
          const hex = rawText.slice(i + 1, i + 7)
          const parsed = parseHexColor(hex)
          if (parsed) {
            currentColor = toCssColor(parsed)
            lastCustomColor = currentColor
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
            currentColor = toCssColor(parsed)
            lastCustomColor = currentColor
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
  parser: MatchSource
  tick: number
}

export const ChatHud = (props: ChatHudProps) => {
  const { parser, tick } = props
  const show = useStore(state => state.settings.ui.showChat !== false)

  const intervalPerTick = parser.intervalPerTick ?? 0.015
  const visible = useMemo(
    () => getVisibleChat(parser.chat ?? [], tick, intervalPerTick),
    [parser, tick, intervalPerTick]
  )

  if (!show || !visible.length || isMobile) {
    return null
  }

  return (
    <div className="hud-chat">
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
          <div key={`chat-${entry.tick}-${idx}`} className="hud-chat__line" style={{ opacity }}>
            {segments.map((seg, segIdx) => (
              <span
                key={segIdx}
                // Literal names: Tailwind drops @layer rules for classes it can't find in source.
                className={
                  seg.kind === 'name' ? 'hud-chat__name' : seg.kind === 'prefix' ? 'hud-chat__prefix' : undefined
                }
                style={seg.kind === 'prefix' ? undefined : { color: seg.color }}
              >
                {seg.text}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}
