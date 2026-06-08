import { describe, expect, it } from 'vitest'

import { normalizePreviewSurfaceBounds } from './native-preview-bounds'

describe('normalizePreviewSurfaceBounds', () => {
  it('preserves valid fractional CSS bounds and device scale for CAMetalLayer drawable sizing', () => {
    expect(
      normalizePreviewSurfaceBounds({
        screenX: 123.4,
        screenY: 56.7,
        width: 640.5,
        height: 360.25,
        scaleFactor: 2,
        screenHeight: 1440.5
      })
    ).toEqual({
      screenX: 123.4,
      screenY: 56.7,
      width: 640.5,
      height: 360.25,
      scaleFactor: 2,
      screenHeight: 1440.5
    })
  })

  it('clamps impossible dimensions and scale before they reach native preview hosts', () => {
    expect(
      normalizePreviewSurfaceBounds({
        screenX: Number.NaN,
        screenY: Number.POSITIVE_INFINITY,
        width: 0,
        height: -10,
        scaleFactor: 0,
        screenHeight: Number.NaN
      })
    ).toEqual({
      screenX: 0,
      screenY: 0,
      width: 1,
      height: 1,
      scaleFactor: 1,
      screenHeight: undefined
    })
  })
})
