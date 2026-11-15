/// <reference lib="webworker" />

import init, { convert, inspect } from '../vendor/bsp-to-glb/bsp_to_glb.js'

type Request =
  | { id: number; kind: 'inspect'; bsp: ArrayBuffer }
  | { id: number; kind: 'convert'; bundle: ArrayBuffer; request: string }

type Response =
  | { id: number; kind: 'inspection'; json: string }
  | { id: number; kind: 'converted'; package: ArrayBuffer }
  | { id: number; kind: 'failure'; message: string }

const scope = self as DedicatedWorkerGlobalScope
let bsp: Uint8Array | undefined
const ready = init()

scope.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data as Request
  void ready
    .then(() => {
      if (request.kind === 'inspect') {
        bsp = new Uint8Array(request.bsp)
        const json = new TextDecoder().decode(inspect(bsp))
        scope.postMessage({ id: request.id, kind: 'inspection', json } satisfies Response)
        return
      }
      if (!bsp) throw new Error('conversion requested before inspection')
      const output = convert(
        bsp,
        new Uint8Array(request.bundle),
        new TextEncoder().encode(request.request)
      )
      const transferred = output.buffer.slice(
        output.byteOffset,
        output.byteOffset + output.byteLength
      ) as ArrayBuffer
      scope.postMessage(
        { id: request.id, kind: 'converted', package: transferred } satisfies Response,
        [transferred]
      )
      bsp = undefined
    })
    .catch(error => {
      scope.postMessage({
        id: request.id,
        kind: 'failure',
        message: error instanceof Error ? error.message : String(error),
      } satisfies Response)
    })
})
