export function assertSourceCompleteCompositorHealthy({ scenarioLabel, stats, sourceComplete }) {
  if (!sourceComplete) {
    return
  }

  const prefix = scenarioLabel ? `[${scenarioLabel}] ` : ''
  const fallbackFrames = count(stats.maxCompositorCpuFallbackFrames)
  const metalTargets = count(stats.maxEncoderBridgeMetalTargetFrames)
  const reason = typeof stats.lastCompositorFallbackReason === 'string' ? stats.lastCompositorFallbackReason : ''

  if (fallbackFrames > 0) {
    throw new Error(
      `${prefix}Source-complete native-preview smoke rendered ${fallbackFrames} CPU fallback frame(s)${reason ? `: ${reason}` : ''}.`
    )
  }
  if (metalTargets <= 0) {
    throw new Error(`${prefix}Source-complete native-preview smoke never reached the Metal compositor target path.`)
  }
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
