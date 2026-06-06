import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assertSourceCompleteCompositorHealthy } from './native-preview-source-gates.mjs'

const healthyStats = () => ({
  maxCompositorCpuFallbackFrames: 0,
  maxEncoderBridgeMetalTargetFrames: 120,
  lastCompositorFallbackReason: null
})

describe('assertSourceCompleteCompositorHealthy', () => {
  it('does not apply source-complete gates to fallback-repro smoke scenes', () => {
    assert.doesNotThrow(() =>
      assertSourceCompleteCompositorHealthy({
        scenarioLabel: 'fallback-repro',
        sourceComplete: false,
        stats: {
          maxCompositorCpuFallbackFrames: 42,
          maxEncoderBridgeMetalTargetFrames: 0
        }
      })
    )
  })

  it('passes a source-complete Metal run without CPU fallback frames', () => {
    assert.doesNotThrow(() =>
      assertSourceCompleteCompositorHealthy({
        scenarioLabel: 'source-complete',
        sourceComplete: true,
        stats: healthyStats()
      })
    )
  })

  it('fails source-complete runs that fall back to the CPU compositor', () => {
    const stats = healthyStats()
    stats.maxCompositorCpuFallbackFrames = 3
    stats.lastCompositorFallbackReason = 'camera source "Camera" frame unavailable'

    assert.throws(
      () =>
        assertSourceCompleteCompositorHealthy({
          scenarioLabel: 'source-complete',
          sourceComplete: true,
          stats
        }),
      /3 CPU fallback frame\(s\): camera source "Camera"/
    )
  })

  it('fails source-complete runs that never reach Metal targets', () => {
    const stats = healthyStats()
    stats.maxEncoderBridgeMetalTargetFrames = 0

    assert.throws(
      () =>
        assertSourceCompleteCompositorHealthy({
          scenarioLabel: 'source-complete',
          sourceComplete: true,
          stats
        }),
      /never reached the Metal compositor target path/
    )
  })
})
