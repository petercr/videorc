import { describe, expect, it } from 'vitest'

import { durationMsLabel } from './format'

describe('format', () => {
  it('spells out recording durations once they pass an hour', () => {
    expect(durationMsLabel(72 * 60 * 1000)).toBe('1 hour and 12 minutes')
    expect(durationMsLabel(60 * 60 * 1000)).toBe('1 hour')
    expect(durationMsLabel(121 * 60 * 1000)).toBe('2 hours and 1 minute')
  })

  it('keeps sub-hour recording durations compact', () => {
    expect(durationMsLabel(12 * 60 * 1000 + 34 * 1000)).toBe('12:34')
    expect(durationMsLabel(undefined)).toBe('--:--')
  })
})
