import type { PreviewSurfaceBounds } from './backend'

export function normalizePreviewSurfaceBounds(bounds: PreviewSurfaceBounds): PreviewSurfaceBounds {
  return {
    screenX: finiteNumber(bounds.screenX, 0),
    screenY: finiteNumber(bounds.screenY, 0),
    width: positiveNumber(bounds.width, 1),
    height: positiveNumber(bounds.height, 1),
    scaleFactor: Math.max(1, positiveNumber(bounds.scaleFactor, 1)),
    screenHeight: optionalPositiveNumber(bounds.screenHeight)
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
