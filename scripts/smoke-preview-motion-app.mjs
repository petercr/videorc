import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { connectBackend, request } from './smoke-recording-session.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const ffmpegPath = process.env.VIDEORC_SMOKE_FFMPEG_PATH ?? 'ffmpeg'
const timeoutMs = Number(process.env.VIDEORC_SMOKE_TIMEOUT_MS ?? 100000)
const measurementMs = Number(process.env.VIDEORC_PREVIEW_MOTION_SAMPLE_MS ?? 10000)
const strictObs = process.env.VIDEORC_PREVIEW_MOTION_STRICT_OBS === '1'
const fallbackMinLoads = Number(process.env.VIDEORC_PREVIEW_MOTION_MIN_LOADS ?? 12)
const fallbackMaxLongTaskMs = Number(process.env.VIDEORC_PREVIEW_MOTION_MAX_LONG_TASK_MS ?? 500)
const obsMinFps = Number(process.env.VIDEORC_PREVIEW_MOTION_OBS_MIN_FPS ?? 55)
const obsMaxFrameAgeMs = Number(process.env.VIDEORC_PREVIEW_MOTION_OBS_MAX_AGE_MS ?? 100)
const obsMaxIntervalP95Ms = Number(process.env.VIDEORC_PREVIEW_MOTION_OBS_MAX_INTERVAL_P95_MS ?? 24)
const outputDirectory = resolve(
  process.env.VIDEORC_SMOKE_OUTPUT_DIR ?? join(tmpdir(), `videorc-preview-motion-${Date.now()}`)
)

let appProcess
let stopping = false

try {
  const { backend, smoke } = await launchAndReadConnections()
  await runPreviewMotionSmoke(backend, smoke)
} finally {
  await stopApp()
}

async function runPreviewMotionSmoke(connection, smoke) {
  const ws = await connectBackend(connection, timeoutMs)
  try {
    const health = await request(ws, timeoutMs, 'health.ping', { ffmpegPath })
    if (!health?.ffmpeg?.available) {
      throw new Error(health?.ffmpeg?.message ?? 'FFmpeg is unavailable for preview motion smoke.')
    }
    console.log(`Preview motion smoke using FFmpeg: ${ffmpegPath}`)

    await request(ws, timeoutMs, 'preview.live.start', previewParams())
    const liveStatus = await waitForLivePreview(ws)
    await smokeCommand(smoke, 'open-layout-tab')

    const measurement = smokeCommand(smoke, 'measure-preview-motion', {
      durationMs: measurementMs,
      expectedIntervalMs: 1000 / 60
    })
    await exerciseLayoutAndMotion(ws, smoke)
    const renderer = await measurement
    const diagnostics = await request(ws, timeoutMs, 'diagnostics.stats')

    assertFallbackHealthy(renderer)
    const obsQualified = isObsQualified(liveStatus, renderer, diagnostics)
    const reason = obsQualified
      ? 'Preview meets OBS-quality Phase 0 strict thresholds.'
      : `Current ${liveStatus.transport} preview is below OBS target: renderer ${format(renderer.measuredFps)}fps, p95 interval ${format(renderer.intervalP95Ms)}ms, frame age ${format(diagnostics.previewFrameAgeMs)}ms.`

    await request(ws, timeoutMs, 'diagnostics.preview_baseline.record', {
      transport: liveStatus.transport,
      targetFps: liveStatus.targetFps,
      measuredFps: renderer.measuredFps,
      presentFps: diagnostics.previewPresentFps,
      frameAgeMs: diagnostics.previewFrameAgeMs,
      cadenceP95Ms: renderer.intervalP95Ms,
      intervalJitterP95Ms: renderer.intervalJitterP95Ms,
      blankFrames: renderer.blankFrames,
      longTasks: renderer.longTaskCount,
      rendererLongTaskP95Ms: renderer.rendererLongTaskP95Ms,
      obsQualified,
      reason
    })

    if (strictObs && !obsQualified) {
      throw new Error(reason)
    }

    console.log(
      `Preview motion baseline: ${liveStatus.transport}, renderer ${format(renderer.measuredFps)}fps, loads ${renderer.imageLoadCount}, p95 interval ${format(renderer.intervalP95Ms)}ms, jitter p95 ${format(renderer.intervalJitterP95Ms)}ms, blanks ${renderer.blankFrames}, long tasks ${renderer.longTaskCount}, frame age ${format(diagnostics.previewFrameAgeMs)}ms, OBS qualified ${obsQualified ? 'yes' : 'no'}`
    )
  } finally {
    try {
      await request(ws, 5000, 'preview.live.stop')
    } catch {
      // Shutdown also stops preview; best-effort cleanup only.
    }
    ws.close()
  }
}

async function exerciseLayoutAndMotion(ws, smoke) {
  const steps = [
    async () => request(ws, timeoutMs, 'preview.live.start', previewParams({ layoutPreset: 'screen-only' })),
    async () => request(ws, timeoutMs, 'preview.live.start', previewParams({ layoutPreset: 'screen-camera' })),
    async () =>
      request(
        ws,
        timeoutMs,
        'preview.live.start',
        previewParams({
          layoutPreset: 'screen-camera',
          cameraTransformMode: 'custom',
          cameraTransform: { x: 0.08, y: 0.1, width: 0.3, height: 0.3 }
        })
      ),
    async () => smokeCommand(smoke, 'resize-window', { width: 1030, height: 720 }),
    async () =>
      request(
        ws,
        timeoutMs,
        'preview.live.start',
        previewParams({
          layoutPreset: 'screen-camera',
          cameraTransformMode: 'custom',
          cameraTransform: { x: 0.62, y: 0.54, width: 0.28, height: 0.28 }
        })
      ),
    async () => smokeCommand(smoke, 'resize-window', { width: 1280, height: 820 }),
    async () => request(ws, timeoutMs, 'preview.live.start', previewParams())
  ]

  for (const step of steps) {
    await sleep(900)
    await step()
  }
}

function assertFallbackHealthy(renderer) {
  if (renderer.imageLoadCount < fallbackMinLoads) {
    throw new Error(`Renderer preview only loaded ${renderer.imageLoadCount} frame(s); expected at least ${fallbackMinLoads}.`)
  }
  if (renderer.blankFrames > 0) {
    throw new Error(`Renderer preview observed ${renderer.blankFrames} blank frame(s).`)
  }
  if ((renderer.maxLongTaskMs ?? 0) > fallbackMaxLongTaskMs) {
    throw new Error(`Renderer long task ${format(renderer.maxLongTaskMs)}ms exceeded ${fallbackMaxLongTaskMs}ms.`)
  }
}

function isObsQualified(status, renderer, diagnostics) {
  return (
    status.transport === 'native-surface' &&
    (status.targetFps ?? 0) >= 60 &&
    (renderer.measuredFps ?? 0) >= obsMinFps &&
    (renderer.intervalP95Ms ?? Number.POSITIVE_INFINITY) <= obsMaxIntervalP95Ms &&
    (diagnostics.previewFrameAgeMs ?? Number.POSITIVE_INFINITY) <= obsMaxFrameAgeMs &&
    renderer.blankFrames === 0
  )
}

async function waitForLivePreview(ws) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = null
  while (Date.now() < deadline) {
    lastStatus = await request(ws, timeoutMs, 'preview.live.status')
    if (lastStatus.state === 'live') {
      return lastStatus
    }
    await sleep(250)
  }
  throw new Error(`Live preview did not become live. Last status: ${JSON.stringify(lastStatus)}`)
}

function previewParams(layoutPatch = {}) {
  const layout = {
    layoutPreset: 'screen-camera',
    cameraTransformMode: 'preset',
    cameraTransform: null,
    cameraCorner: 'bottom-right',
    cameraSize: 'medium',
    cameraShape: 'rectangle',
    cameraMargin: 32,
    cameraFit: 'fill',
    cameraMirror: false,
    cameraZoom: 100,
    cameraOffsetX: 0,
    cameraOffsetY: 0,
    sideBySideSplit: '70-30',
    sideBySideCameraSide: 'right',
    ...layoutPatch
  }

  return {
    sources: { testPattern: true },
    layout,
    ffmpegPath,
    video: {
      preset: 'custom',
      width: 1280,
      height: 720,
      fps: 60,
      bitrateKbps: 4000
    }
  }
}

async function smokeCommand(smoke, command, params = {}) {
  const response = await fetch(`http://${smoke.host}:${smoke.port}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params })
  })
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `${command} smoke command failed.`)
  }
  return payload.result
}

function launchAndReadConnections() {
  return new Promise((resolveConnections, rejectConnections) => {
    const timer = setTimeout(() => {
      rejectConnections(new Error(`Timed out waiting for smoke connections after ${timeoutMs}ms.`))
    }, timeoutMs)
    const connections = { backend: null, smoke: null }

    appProcess = spawn('pnpm', ['dev'], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        VIDEORC_SMOKE_OUTPUT_DIR: outputDirectory,
        VIDEORC_SMOKE_PREVIEW_MOTION: '1',
        VIDEORC_SMOKE_PRINT_BACKEND_READY: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const maybeResolve = () => {
      if (connections.backend && connections.smoke) {
        clearTimeout(timer)
        resolveConnections(connections)
      }
    }
    const handleOutput = (text) => handleAppOutput(text, connections, maybeResolve)

    appProcess.stdout.setEncoding('utf8')
    appProcess.stderr.setEncoding('utf8')
    appProcess.stdout.on('data', handleOutput)
    appProcess.stderr.on('data', handleOutput)
    appProcess.on('error', (error) => {
      clearTimeout(timer)
      rejectConnections(error)
    })
    appProcess.on('exit', (code, signal) => {
      clearTimeout(timer)
      rejectConnections(new Error(`Dev app exited before preview motion smoke completed: code=${code} signal=${signal}`))
    })
  })
}

function handleAppOutput(text, connections, maybeResolve) {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() && !stopping) {
      console.log(line)
    }

    const backendMarker = '[smoke] backend-ready '
    const backendIndex = line.indexOf(backendMarker)
    if (backendIndex !== -1) {
      connections.backend = JSON.parse(line.slice(backendIndex + backendMarker.length))
      maybeResolve()
      continue
    }

    const smokeMarker = '[smoke] preview-motion-ready '
    const smokeIndex = line.indexOf(smokeMarker)
    if (smokeIndex !== -1) {
      connections.smoke = JSON.parse(line.slice(smokeIndex + smokeMarker.length))
      maybeResolve()
    }
  }
}

function stopApp() {
  return new Promise((resolveStop) => {
    if (!appProcess?.pid || appProcess.killed) {
      resolveStop()
      return
    }

    const timer = setTimeout(() => {
      killApp('SIGKILL')
      resolveStop()
    }, 5000)

    stopping = true
    appProcess.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
    killApp('SIGTERM')
  })
}

function killApp(signal) {
  if (!appProcess?.pid) {
    return
  }

  try {
    process.kill(-appProcess.pid, signal)
  } catch {
    appProcess.kill(signal)
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function format(value) {
  return typeof value === 'number' ? value.toFixed(1) : 'n/a'
}
