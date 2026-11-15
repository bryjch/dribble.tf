import type { CachedDeath } from './MatchSource'
import type { MatchUberEvent } from '@utils/matchEvents'
import { ChatEntry, PlayerRef, Round, TeamName } from './Types'

//
// ─── STVTF EVENTS ───────────────────────────────────────────────────────────────
//
// stvtf's output lines, as the viewer keeps them. A live match gets them from stv.tf's event
// stream (LiveSource); a demo from stvtf run in the browser (ParseWorker). Both turn them into
// the same deaths, chat, rounds and ubers here.
//

/** One line of stvtf's output; see the stvtf README for the fields of each type. */
export type StreamMessage = { type: string; tick?: number; history?: boolean; [key: string]: any }

/** Who a player id (stvtf's `userid`) in a line is, or null if nobody known. */
export type PlayerLookup = (id: number | null | undefined) => PlayerRef | null

export const CLASS_IDS: Record<string, number> = {
  scout: 1,
  sniper: 2,
  soldier: 3,
  demoman: 4,
  medic: 5,
  heavy: 6,
  pyro: 7,
  spy: 8,
  engineer: 9,
}

export const TEAM_IDS: Record<string, number> = { spectator: 1, red: 2, blue: 3 }

export const teamName = (team: string): TeamName =>
  team === 'red' || team === 'blue' || team === 'spectator' ? team : ''

const CHAT_PREFIXES: Record<string, string> = {
  ChatTeam: '(TEAM) ',
  ChatAllDead: '*DEAD* ',
  ChatTeamDead: '*DEAD*(TEAM) ',
  ChatAllSpec: '*SPEC* ',
}

const teamIdOf = (p: PlayerRef | null) => (p ? (TEAM_IDS[p.user.team] ?? 0) : 0)

export function toDeath(tick: number, m: StreamMessage, refOf: PlayerLookup): CachedDeath | null {
  const victim = refOf(m.victim)
  if (!victim) return null
  const killer = refOf(m.attacker)
  const assister = refOf(m.assister)
  return {
    tick,
    victim,
    killer,
    assister,
    weapon: m.weapon ?? '',
    victimTeam: teamIdOf(victim),
    killerTeam: teamIdOf(killer),
    assisterTeam: teamIdOf(assister),
  }
}

/** TF2's colour codes for a line stvtf split into coloured parts: 1 normal, 3 the sender's team
 * colour, 7 a hex colour. */
const partsToMarkup = (parts: { c: string | null; t: string }[]) =>
  parts.map(({ c, t }) => (c === 'team' ? '\x03' : c ? `\x07${c}` : '\x01') + t).join('')

/** A `chat` or `server_text` line as the chat HUD shows it; null for one with nothing to show. */
export function toChatEntry(tick: number, m: StreamMessage, slot: number | null): ChatEntry | null {
  if (m.type === 'server_text') {
    return m.text ? { tick, kind: 'Empty', rawText: `\x01${m.text}`, clientPlayerId: null } : null
  }
  if (m.kind === 'Empty' || m.kind === 'NameChange' || !m.text) return null
  const rawText =
    m.player == null || m.kind === 'SayText'
      ? Array.isArray(m.parts)
        ? partsToMarkup(m.parts)
        : `\x01${m.text}`
      : `\x01${CHAT_PREFIXES[m.kind] ?? ''}\x03${m.name}\x01 :  ${m.text}`
  return { tick, kind: m.kind, rawText, clientPlayerId: slot }
}

export function toUberPop(tick: number, m: StreamMessage, refOf: PlayerLookup): MatchUberEvent | null {
  const medic = refOf(m.medic)
  if (!medic) return null
  return {
    type: 'uber',
    tick,
    medicName: medic.user.name,
    medicTeam: TEAM_IDS[medic.user.team] ?? 0,
    medicEntityId: medic.user.entityId,
  }
}

export const toRound = (tick: number, m: StreamMessage): Round => ({
  winner: m.team,
  length: m.round_time ?? 0,
  endTick: tick,
})

//
// ─── PLAYER STATUS ──────────────────────────────────────────────────────────────
//

/**
 * The player conditions kept, one bit each in this order (decoder/src/lib.rs, CONDITIONS, has
 * the same list), with the TF2 conditions that count as each; a trailing * matches any
 * condition starting so.
 */
export const CONDITION_FLAGS = [
  ['burning', ['Burning', 'BurningPyro']],
  ['jarate', ['Urine']],
  ['milk', ['MadMilk']],
  ['bleeding', ['Bleeding']],
  ['marked', ['MarkedForDeath*']],
  ['cloaked', ['Stealthed', 'StealthedBlink']],
  ['disguised', ['Disguised']],
  ['crits', ['CritBoosted*']],
  ['minicrits', ['OffensiveBuff', 'EnergyBuff']],
  ['defense', ['DefensiveBuff', 'DefenseBuffNoCritBlock', 'DefenseBuffHigh']],
  ['regen', ['RegenOnDamageBuff']],
  ['speed', ['SpeedBoost']],
  ['stunned', ['Stunned']],
  ['overhealed', ['HealthOverHealed']],
  ['blastJumping', ['BlastJumping']],
  ['zoomed', ['Zoomed']],
  ['taunting', ['Taunting']],
  ['ubered', ['Invulnerable*']],
  ['bonk', ['Phase']],
] as const

export type ConditionFlag = (typeof CONDITION_FLAGS)[number][0]

const CONDITION_BIT = Object.fromEntries(CONDITION_FLAGS.map(([flag], bit) => [flag, 1 << bit])) as Record<
  ConditionFlag,
  number
>

/** Whether a player's condition bits (CachedPlayer.conditions) include a flag. */
export const hasCondition = (conditions: number, flag: ConditionFlag) =>
  (conditions & CONDITION_BIT[flag]) !== 0

/** The bits for stvtf's condition names, as the decoder packs them. */
export function conditionBits(conds: readonly string[] | undefined): number {
  let bits = 0
  for (const name of conds ?? []) {
    CONDITION_FLAGS.forEach(([, names], bit) => {
      const hit = names.some(n => (n.endsWith('*') ? name.startsWith(n.slice(0, -1)) : name === n))
      if (hit) bits |= 1 << bit
    })
  }
  return bits
}

export type UberedKind =
  | 'uber'
  | 'kritz'
  | 'quickfix'
  | 'vaccinator_bullet'
  | 'vaccinator_blast'
  | 'vaccinator_fire'
export type MedigunKind = 'medigun' | 'kritzkrieg' | 'quickfix' | 'vaccinator'
export type Resist = 'bullet' | 'blast' | 'fire'

export interface MedigunState {
  kind: MedigunKind
  releasing: boolean
  resist: Resist | null
}

const UBERED: (UberedKind | null)[] = [
  null,
  'uber',
  'kritz',
  'quickfix',
  'vaccinator_bullet',
  'vaccinator_blast',
  'vaccinator_fire',
]
const MEDIGUNS: (MedigunKind | null)[] = [null, 'medigun', 'kritzkrieg', 'quickfix', 'vaccinator']
const RESISTS: (Resist | null)[] = [null, 'bullet', 'blast', 'fire']

/**
 * The medigun charge state in 16 bits, as the decoder packs it: bits 0-2 the charge a player
 * is under, 4-6 a medic's medigun, 7 releasing, 8-9 the vaccinator's resistance.
 */
export function chargeBits(ubered: string | null | undefined, medigun: any): number {
  const under = Math.max(0, UBERED.indexOf((ubered ?? null) as UberedKind | null))
  if (!medigun) return under
  const kind = Math.max(0, MEDIGUNS.indexOf(medigun.kind))
  const resist = Math.max(0, RESISTS.indexOf(medigun.resist ?? null))
  return under | (kind << 4) | (medigun.releasing ? 1 << 7 : 0) | (resist << 8)
}

export const uberedOf = (bits: number): UberedKind | null => UBERED[bits & 0x7] ?? null

export function medigunOf(bits: number): MedigunState | null {
  const kind = MEDIGUNS[(bits >> 4) & 0x7]
  if (!kind) return null
  return { kind, releasing: (bits & 0x80) !== 0, resist: RESISTS[(bits >> 8) & 0x3] ?? null }
}

/** stvtf's building kinds, as numbered in the decoder's building tracks. */
export const BUILDING_KINDS = ['', 'sentry', 'dispenser', 'teleporter'] as const
export type BuildingKind = Exclude<(typeof BUILDING_KINDS)[number], ''>
