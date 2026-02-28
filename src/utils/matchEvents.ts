import { AsyncParser, CachedDeath } from '@components/Analyse/Data/AsyncParser'

export interface MatchKillEvent {
  type: 'kill'
  tick: number
  killer: CachedDeath['killer']
  victim: CachedDeath['victim']
  assister: CachedDeath['assister']
  weapon: string
  killerTeam: number
  victimTeam: number
  assisterTeam: number
}

export interface MatchUberEvent {
  type: 'uber'
  tick: number
  medicName: string
  medicTeam: number
  medicEntityId: number
}

export type MatchEvent = MatchKillEvent | MatchUberEvent

// ─── KILLSTREAK DETECTION ────────────────────────────────────────────────────────

export const KILLSTREAK_GRACE_PERIOD_SECONDS = 10

export interface KillstreakInfo {
  streakCount: number
  streakIndex: number // 1-based position within the streak
}

export interface AnnotatedMatchKillEvent extends MatchKillEvent {
  streak: KillstreakInfo | null
}

export function annotateKillstreaks(
  kills: MatchKillEvent[],
  tickRate: number
): AnnotatedMatchKillEvent[] {
  const graceTicks = KILLSTREAK_GRACE_PERIOD_SECONDS * tickRate

  // Pass 1: Build streak groups
  // Track last kill tick per player and current group
  const lastKillTick = new Map<string, number>()
  const currentGroupStart = new Map<string, number>() // steamId → index of group start
  const groups = new Map<number, number[]>() // startIndex → [indices in this group]

  for (let i = 0; i < kills.length; i++) {
    const kill = kills[i]
    const { killer, victim } = kill

    // Skip world kills and self-kills
    if (!killer || killer.user.steamId === victim.user.steamId) continue

    const steamId = killer.user.steamId
    const prevTick = lastKillTick.get(steamId)

    if (prevTick !== undefined && kill.tick - prevTick <= graceTicks) {
      // Extend current group
      const groupStart = currentGroupStart.get(steamId)!
      groups.get(groupStart)!.push(i)
    } else {
      // Start new group
      currentGroupStart.set(steamId, i)
      groups.set(i, [i])
    }

    lastKillTick.set(steamId, kill.tick)
  }

  // Pass 2: Annotate kills that belong to groups of 2+
  const streakMap = new Map<number, KillstreakInfo>()
  for (const [, indices] of groups) {
    if (indices.length < 2) continue
    for (let j = 0; j < indices.length; j++) {
      streakMap.set(indices[j], {
        streakCount: indices.length,
        streakIndex: j + 1,
      })
    }
  }

  return kills.map((kill, i) => ({
    ...kill,
    streak: streakMap.get(i) ?? null,
  }))
}

export function getAllKills(parser: AsyncParser): MatchKillEvent[] {
  const kills: MatchKillEvent[] = []

  for (const tickKey in parser.deaths) {
    const deaths = parser.deaths[tickKey]
    for (const death of deaths) {
      kills.push({
        type: 'kill',
        tick: death.tick,
        killer: death.killer,
        victim: death.victim,
        assister: death.assister,
        weapon: death.weapon,
        killerTeam: death.killerTeam,
        victimTeam: death.victimTeam,
        assisterTeam: death.assisterTeam,
      })
    }
  }

  kills.sort((a, b) => a.tick - b.tick)
  return kills
}

export function getUberPops(parser: AsyncParser): MatchUberEvent[] {
  const events: MatchUberEvent[] = []
  const { uberCache, metaCache } = parser.playerCache
  const step = 1 << uberCache.sparse

  for (let i = 0; i < parser.nextMappedPlayer; i++) {
    const entity = parser.entityPlayerMap.get(i)
    if (!entity) continue

    for (let tick = step; tick < parser.ticks; tick += step) {
      const prevCharge = uberCache.getOrNull(i, tick - step)
      const currCharge = uberCache.getOrNull(i, tick)

      // Detect when charge crosses below 95 from a near-full state.
      // Uber drains ~3% per 16-tick sample, so a single-step drop from
      // >=95 to <95 reliably catches the first moment of activation.
      if (prevCharge !== null && currCharge !== null && prevCharge >= 95 && currCharge < 95) {
        const meta = metaCache.getMeta(i, tick)
        if (meta.classId === 5) {
          events.push({
            type: 'uber',
            tick,
            medicName: entity.user.name,
            medicTeam: meta.teamId,
            medicEntityId: entity.user.entityId,
          })
        }
      }
    }
  }

  events.sort((a, b) => a.tick - b.tick)
  return events
}
