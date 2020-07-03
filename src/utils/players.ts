import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'

import { ORDER_MAP, HEALTH_MAP } from '@constants/mappings'

/*
 * Function to sort Players based on classId descending.
 * (i.e. scout, soldier, ... , sniper, spy)
 */

export const sortPlayersByClassId = (a: CachedPlayer, b: CachedPlayer) => {
  return ORDER_MAP[a.classId] < ORDER_MAP[b.classId] ? -1 : 1
}

/*
 * Return health information for a given class.
 */

export const parseClassHealth = (classId: number, health: number) => {
  const current = health
  const max = HEALTH_MAP[classId] || 100
  const ratio = current / max
  const percentage = ratio * 100

  return { current, max, ratio, percentage }
}
