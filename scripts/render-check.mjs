#!/usr/bin/env node
//
// Render and performance check: drives the viewer in headless Chrome through ?bench (see
// src/utils/bench.ts), takes screenshots at fixed ticks and cameras, and measures loading,
// playback and GPU memory. Two runs (before/after a change) are compared with `compare`.
//
//   node scripts/render-check.mjs run --url http://localhost:4173 --out bench/before
//   node scripts/render-check.mjs run --url http://localhost:4173 --out bench/after --scenarios bench/before/scenarios.json
//   node scripts/render-check.mjs compare bench/before bench/after
//
// Uses the installed Google Chrome with its GPU (ANGLE/Metal on macOS) and ImageMagick's
// `compare` for image diffs. Run it against a production build (`npm run build && npx vite
// preview`) so timings are not dev-server timings.
//

import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTH = 1280
const HEIGHT = 720
const DEMO = '/samples/i52_snakewater_gc.dem'
const OTHER_MAP = 'cp_process_f12'
const DEMO_MAP = 'cp_snakewater_final1'
const PLAYBACK_MS = 8000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function parseArgs(argv) {
  const [command, ...rest] = argv
  const args = { _: [] }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i]
    else args._.push(rest[i])
  }
  return { command, args }
}

// ─── Chrome over CDP ────────────────────────────────────────────────────────────

async function launchChrome(port) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'render-check-'))
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--use-angle=metal',
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
      `--window-size=${WIDTH},${HEIGHT}`,
      '--hide-scrollbars',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' }
  )
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`)
      break
    } catch {
      await sleep(250)
    }
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 0
  const pending = new Map()
  const consoleErrors = []
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(`${message.error.message}`))
      else resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? 'exception')
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map(a => a.value ?? a.description).join(' '))
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? expression)
    }
    return result.result.value
  }
  const close = () => {
    ws.close()
    proc.kill()
  }
  return { send, evaluate, close, consoleErrors }
}

const call = (page, fn, ...args) =>
  page.evaluate(`window.__dribble.${fn}(${args.map(a => JSON.stringify(a)).join(',')})`)

async function waitFor(label, check, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await check()) return Date.now() - start
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

/** Waits until the map is drawn and no download is running, and the triangle count has settled. */
async function waitForScene(page) {
  let last = -1
  let stable = 0
  let status
  return waitFor('scene', async () => {
    status = await call(page, 'status')
    if (status.triangles < 50000) return false
    stable = status.triangles === last ? stable + 1 : 0
    last = status.triangles
    return stable >= 3
  }).catch(error => {
    throw new Error(`${error.message}: ${JSON.stringify(status)}`)
  })
}

async function heapMb(page) {
  await page.send('HeapProfiler.collectGarbage')
  await sleep(300)
  await page.send('HeapProfiler.collectGarbage')
  const { usedSize } = await page.send('Runtime.getHeapUsage')
  return +(usedSize / 1024 / 1024).toFixed(1)
}

async function screenshot(page, out, name) {
  await sleep(400)
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(out, 'shots', `${name}.png`), Buffer.from(data, 'base64'))
}

const metricsMap = metrics => Object.fromEntries(metrics.metrics.map(m => [m.name, m.value]))

/** Plays for PLAYBACK_MS and reports frame times, main-thread time and React viewer renders. */
async function measurePlayback(page, speed, cpuThrottle = 1) {
  await page.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
  await call(page, 'resetCounters')
  const before = metricsMap(await page.send('Performance.getMetrics'))
  await call(page, 'play', speed)
  const sample = await page.evaluate(`new Promise(resolve => {
    const deltas = [], calls = [], triangles = []
    let longTasks = 0
    const observer = new PerformanceObserver(list => { longTasks += list.getEntries().length })
    try { observer.observe({ entryTypes: ['longtask'] }) } catch {}
    let last = performance.now()
    const end = last + ${PLAYBACK_MS}
    const frame = t => {
      deltas.push(t - last)
      last = t
      if (deltas.length % 15 === 0) {
        const info = window.__dribble.renderInfo()
        calls.push(info.calls)
        triangles.push(info.triangles)
      }
      if (t < end) requestAnimationFrame(frame)
      else { observer.disconnect(); resolve({ deltas, calls, triangles, longTasks }) }
    }
    requestAnimationFrame(frame)
  })`)
  const after = metricsMap(await page.send('Performance.getMetrics'))
  const counters = await call(page, 'counters')
  await call(page, 'pause')
  await page.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const seconds = PLAYBACK_MS / 1000
  const sorted = [...sample.deltas].sort((a, b) => a - b)
  const pct = p => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2)
  const avg = list => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0)
  const perSecond = key => +(((after[key] ?? 0) - (before[key] ?? 0)) * 1000 / seconds).toFixed(1)
  return {
    speed,
    cpuThrottle,
    frames: sample.deltas.length,
    fps: +(sample.deltas.length / seconds).toFixed(1),
    frameMsP50: pct(0.5),
    frameMsP95: pct(0.95),
    frameMsP99: pct(0.99),
    frameMsMax: +sorted[sorted.length - 1].toFixed(2),
    framesOver20ms: sample.deltas.filter(d => d > 20).length,
    longTasks: sample.longTasks,
    scriptMsPerSec: perSecond('ScriptDuration'),
    taskMsPerSec: perSecond('TaskDuration'),
    layoutMsPerSec: perSecond('LayoutDuration'),
    styleMsPerSec: perSecond('RecalcStyleDuration'),
    viewerRendersPerSec: +((counters.viewerRender ?? 0) / seconds).toFixed(1),
    sceneRenderMsAvg: counters.renders ? +(counters.renderMs / counters.renders).toFixed(2) : 0,
    nonRenderMsPerSec: +(perSecond('TaskDuration') - (counters.renderMs ?? 0) / seconds).toFixed(1),
    drawCallsAvg: avg(sample.calls),
    trianglesAvg: avg(sample.triangles),
  }
}

// ─── run ────────────────────────────────────────────────────────────────────────

async function run(args) {
  const base = args.url ?? 'http://localhost:4173'
  const out = args.out ?? 'bench/run'
  mkdirSync(join(out, 'shots'), { recursive: true })
  const page = await launchChrome(Number(args.port ?? 9340))
  const results = { url: base, startedAt: new Date().toISOString(), screenshots: [], playback: {} }

  try {
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Performance.enable')
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    })

    // ── Load ──
    const loadStart = Date.now()
    await page.send('Page.navigate', { url: `${base}/?bench&demoUrl=${encodeURIComponent(DEMO)}` })
    await waitFor('bench hook', () => page.evaluate('!!window.__dribble'), 30000)
    await waitFor('demo', async () => (await call(page, 'status')).demoLoaded)
    results.load = { demoReadyMs: Date.now() - loadStart }
    await waitForScene(page)
    results.load.sceneReadyMs = Date.now() - loadStart
    const status = await call(page, 'status')
    results.load.parse = status.perf
    results.load.maxTicks = status.maxTicks
    await call(page, 'pause')
    await call(page, 'setting', 'ui.showStats', false)
    results.load.heapMbAfterLoad = await heapMb(page)
    results.sceneDelayTicks = await call(page, 'sceneDelayTicks')

    // ── Scenarios: picked once (the before run) and reused so both runs see the same moments ──
    let scenarios
    if (args.scenarios && existsSync(args.scenarios)) {
      scenarios = JSON.parse(readFileSync(args.scenarios, 'utf8'))
    } else {
      let busiestTick = 2000
      let busiest = -1
      for (let tick = 2000; tick < status.maxTicks - 2000; tick += 33) {
        const count = await call(page, 'projectileCount', tick)
        if (count > busiest) {
          busiest = count
          busiestTick = tick
        }
      }
      await call(page, 'rts')
      await call(page, 'seek', 800)
      const defaultCamera = await call(page, 'captureCamera')
      const target = defaultCamera.target
      const close = {
        mode: 'rts',
        target,
        position: [target[0] + 350, target[1] - 700, target[2] + 300],
      }
      const povPlayer = (await call(page, 'players', 12000))
        .filter(p => p.alive)
        .sort((a, b) => a.entityId - b.entityId)[0]
      scenarios = { busiestTick, busiest, defaultCamera, close, povEntityId: povPlayer.entityId }
    }
    writeFileSync(join(out, 'scenarios.json'), JSON.stringify(scenarios, null, 2))
    results.scenarios = scenarios

    // ── Screenshots (paused) ──
    const shoot = async (name, prepare) => {
      await prepare()
      await screenshot(page, out, name)
      results.screenshots.push({ name, renderInfo: await call(page, 'renderInfo') })
    }
    const overview = () => call(page, 'camera', scenarios.defaultCamera)
    await call(page, 'rts')
    // The camera the viewer puts itself in after loading the demo (nothing has moved it yet).
    await shoot('01-default-rts-t800', () => call(page, 'seek', 800))
    await shoot('02-overview-busiest', async () => {
      await overview()
      await call(page, 'seek', scenarios.busiestTick)
    })
    await shoot('03-overview-t9000', async () => {
      await overview()
      await call(page, 'seek', 9000)
    })
    await shoot('04-close-t15000', async () => {
      await call(page, 'camera', scenarios.close)
      await call(page, 'seek', 15000)
    })
    await shoot('05-pov-t12000', async () => {
      await call(page, 'seek', 12000)
      await call(page, 'pov', scenarios.povEntityId)
      await call(page, 'seek', 12000)
    })
    await shoot('06-pov-busiest', async () => {
      await call(page, 'seek', scenarios.busiestTick)
      await call(page, 'pov', scenarios.povEntityId)
      await call(page, 'seek', scenarios.busiestTick)
    })
    await call(page, 'rts')
    await shoot('07-untextured-t9000', async () => {
      await call(page, 'setting', 'scene.mode', 'untextured')
      await waitForScene(page)
      await overview()
      await call(page, 'seek', 9000)
    })
    await call(page, 'setting', 'scene.mode', 'textured')
    await waitForScene(page)

    // ── Playback ──
    await overview()
    await call(page, 'seek', 800)
    results.playback.rts1x = await measurePlayback(page, 1)
    await overview()
    await call(page, 'seek', 5000)
    results.playback.rts3x = await measurePlayback(page, 3)
    await call(page, 'seek', 12000)
    await call(page, 'pov', scenarios.povEntityId)
    results.playback.pov1x = await measurePlayback(page, 1)
    await call(page, 'rts')
    // With the CPU slowed 4×, CPU-bound work shows in the frame rate instead of hiding under vsync.
    await overview()
    await call(page, 'seek', 800)
    results.playback.rts1xCpu4 = await measurePlayback(page, 1, 4)
    await call(page, 'seek', 12000)
    await call(page, 'pov', scenarios.povEntityId)
    results.playback.pov1xCpu4 = await measurePlayback(page, 1, 4)
    await call(page, 'rts')

    // ── GPU memory across map and mode changes ──
    const memory = { start: await call(page, 'renderInfo') }
    for (const mode of ['untextured', 'textured', 'untextured', 'textured']) {
      await call(page, 'setting', 'scene.mode', mode)
      await waitForScene(page)
    }
    memory.afterModeToggles = await call(page, 'renderInfo')
    for (let i = 0; i < 2; i++) {
      await call(page, 'loadMap', OTHER_MAP)
      await waitForScene(page)
      await call(page, 'loadMap', DEMO_MAP)
      await waitForScene(page)
    }
    memory.afterMapSwitches = await call(page, 'renderInfo')
    memory.heapMbAfterMapSwitches = await heapMb(page)
    results.memory = memory
    results.consoleErrors = page.consoleErrors.slice(0, 50)
  } finally {
    writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
    page.close()
  }
  console.log(JSON.stringify({ load: results.load, playback: results.playback, memory: results.memory }, null, 2))
}

// ─── compare ────────────────────────────────────────────────────────────────────

function compare(args) {
  const [beforeDir, afterDir] = args._
  const out = args.out ?? join(afterDir, 'diff')
  mkdirSync(out, { recursive: true })
  const rows = []
  for (const file of readdirSync(join(beforeDir, 'shots')).filter(f => f.endsWith('.png')).sort()) {
    const a = join(beforeDir, 'shots', file)
    const b = join(afterDir, 'shots', file)
    if (!existsSync(b)) {
      rows.push(`| ${file} | missing | | |`)
      continue
    }
    const metric = name => {
      try {
        return execFileSync('magick', ['compare', '-metric', name, '-fuzz', '10%', a, b, join(out, file)], {
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString()
      } catch (error) {
        // compare exits 1 when the images differ; the metric is on stderr.
        return error.stderr.toString()
      }
    }
    const changed = Number(metric('AE').trim().split(/\s/)[0])
    const percent = ((changed / (WIDTH * HEIGHT)) * 100).toFixed(2)
    rows.push(`| ${file.replace('.png', '')} | ${changed} | ${percent}% | diff/${file} |`)
  }
  const before = JSON.parse(readFileSync(join(beforeDir, 'results.json'), 'utf8'))
  const after = JSON.parse(readFileSync(join(afterDir, 'results.json'), 'utf8'))
  const line = (label, a, b) => {
    const delta = typeof a === 'number' && typeof b === 'number' && a !== 0 ? ` (${(((b - a) / a) * 100).toFixed(0)}%)` : ''
    return `| ${label} | ${a ?? '–'} | ${b ?? '–'}${delta} |`
  }
  const perf = [
    line('Demo ready (ms)', before.load?.demoReadyMs, after.load?.demoReadyMs),
    line('Scene ready (ms)', before.load?.sceneReadyMs, after.load?.sceneReadyMs),
    line('Decode (ms)', before.load?.parse?.parseMs && Math.round(before.load.parse.parseMs), after.load?.parse?.parseMs && Math.round(after.load.parse.parseMs)),
    line('JS heap after load (MB)', before.load?.heapMbAfterLoad, after.load?.heapMbAfterLoad),
  ]
  for (const key of Object.keys(before.playback ?? {})) {
    const a = before.playback[key]
    const b = after.playback?.[key] ?? {}
    for (const metricKey of ['fps', 'frameMsP50', 'frameMsP95', 'frameMsP99', 'framesOver20ms', 'longTasks', 'scriptMsPerSec', 'taskMsPerSec', 'sceneRenderMsAvg', 'nonRenderMsPerSec', 'viewerRendersPerSec', 'drawCallsAvg']) {
      perf.push(line(`${key} ${metricKey}`, a[metricKey], b[metricKey]))
    }
  }
  for (const key of ['geometries', 'textures']) {
    perf.push(line(`GPU ${key}: start`, before.memory?.start?.[key], after.memory?.start?.[key]))
    perf.push(line(`GPU ${key}: after 4 mode toggles`, before.memory?.afterModeToggles?.[key], after.memory?.afterModeToggles?.[key]))
    perf.push(line(`GPU ${key}: after 4 map switches`, before.memory?.afterMapSwitches?.[key], after.memory?.afterMapSwitches?.[key]))
  }
  perf.push(line('JS heap after map switches (MB)', before.memory?.heapMbAfterMapSwitches, after.memory?.heapMbAfterMapSwitches))

  const markdown = [
    '## Screenshots (pixels differing by more than 10%)',
    '',
    '| Shot | Pixels | Share | Diff |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Performance',
    '',
    '| Metric | Before | After |',
    '|---|---|---|',
    ...perf,
    '',
  ].join('\n')
  writeFileSync(join(out, 'compare.md'), markdown)
  console.log(markdown)
}

const { command, args } = parseArgs(process.argv.slice(2))
if (command === 'run') await run(args)
else if (command === 'compare') compare(args)
else {
  console.error('usage: render-check.mjs run --url <url> --out <dir> [--scenarios <file>] | compare <before> <after>')
  process.exit(1)
}
