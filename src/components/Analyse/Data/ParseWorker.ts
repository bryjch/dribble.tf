import { Parser } from './Parser'
import { CachedDemo } from './AsyncParser'

declare function postMessage(message: any, transfer?: any[]): void

/**
 * @global postMessage
 * @param event
 */
onmessage = (event: MessageEvent) => {
  const buffer = event.data.buffer
  const parser = new Parser(buffer)

  try {
    parser.cacheData(progress => {
      postMessage({ progress })
    })
  } catch (e) {
    console.error(e)
    postMessage({
      error: e.message,
    })
    return
  }

  const cachedDemo: CachedDemo = {
    ticks: parser.ticks,
    header: parser.header,
    playerCache: parser.playerCache,
    buildingCache: parser.buildingCache,
    projectileCache: parser.projectileCache,
    deaths: parser.deaths,
    intervalPerTick: parser.match.intervalPerTick,
    world: parser.match.world,
    rounds: parser.match.rounds,
    nextMappedPlayer: parser.nextMappedPlayer,
    entityPlayerMap: parser.entityPlayerMap,
    now: performance.now(),
  }

  let transfers: (ArrayBuffer | SharedArrayBuffer)[] = []
  transfers = transfers.concat(parser.playerCache.positionCache.data.map(cache => cache.buffer))
  transfers = transfers.concat(parser.playerCache.viewAnglesCache.data.map(cache => cache.buffer))
  transfers = transfers.concat(parser.playerCache.healthCache.data.map(cache => cache.buffer))
  transfers = transfers.concat(parser.playerCache.metaCache.data.map(cache => cache.buffer))
  transfers = transfers.concat(parser.playerCache.connectedCache.data.map(cache => cache.buffer))

  postMessage(cachedDemo, transfers)
}
