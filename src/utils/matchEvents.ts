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
