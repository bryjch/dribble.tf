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
    buildingCache: parser.buildingCache,
    deaths: parser.deaths,
    ticks: parser.ticks,
    header: parser.header,
    playerCache: parser.playerCache,
    intervalPerTick: parser.match.intervalPerTick * 2,
    world: parser.match.world,
    entityPlayerMap: parser.entityPlayerMap,
    nextMappedPlayer: parser.nextMappedPlayer,
    now: performance.now(),
  }
  let transfers: (ArrayBuffer | SharedArrayBuffer)[] = []
  transfers = transfers.concat(parser.playerCache.positionCache.data.map(cache => cache.buffer))
  transfers = transfers.concat(parser.playerCache.healthCache.data.map(cache => cache.buffer))
  transfers = transfers.concat(parser.playerCache.metaCache.data.map(cache => cache.buffer))
  transfers = transfers.concat(parser.playerCache.viewAnglesCache.data.map(cache => cache.buffer))
  postMessage(cachedDemo, transfers)
}
