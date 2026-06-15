import { describe, expect, it } from 'vitest'

import {
  BACKGROUND_SLOT_COUNT,
  applySlot,
  canApplySlot,
  clearActiveSlot,
  createDefaultRegistry,
  defaultBackgroundStyle,
  reconcileRegistry,
  slotDisplayStatus,
  slotName,
  type BackgroundAsset,
  type BackgroundAssetRegistry,
  type BackgroundAssetSlot
} from './background-assets'

function readyAsset(id: string, name: string): BackgroundAsset {
  return {
    id,
    name,
    kind: 'imported',
    assetPath: `/managed/${id}.png`,
    status: 'ready',
    styleDefaults: defaultBackgroundStyle(),
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z'
  }
}

// Wire an imported, applyable ('ready') asset into a slot — the state an A2
// placeholder slot can't reach on its own until import (A4).
function withReadySlot(
  registry: BackgroundAssetRegistry,
  slotId: string,
  asset: BackgroundAsset
): BackgroundAssetRegistry {
  return {
    ...registry,
    assets: { ...registry.assets, [asset.id]: asset },
    slots: registry.slots.map((slot) =>
      slot.id === slotId ? { ...slot, assetId: asset.id, status: 'ready' } : slot
    )
  }
}

function slotById(registry: BackgroundAssetRegistry, id: string): BackgroundAssetSlot {
  const slot = registry.slots.find((entry) => entry.id === id)
  if (!slot) {
    throw new Error(`missing slot ${id}`)
  }
  return slot
}

describe('background asset model', () => {
  it('creates exactly ten empty placeholder slots with the locked ids and labels', () => {
    const registry = createDefaultRegistry()
    expect(BACKGROUND_SLOT_COUNT).toBe(10)
    expect(registry.slots).toHaveLength(10)
    expect(registry.slots.map((slot) => slot.id)).toEqual([
      'bg-01',
      'bg-02',
      'bg-03',
      'bg-04',
      'bg-05',
      'bg-06',
      'bg-07',
      'bg-08',
      'bg-09',
      'bg-10'
    ])
    expect(registry.slots.map((slot) => slot.defaultLabel)).toEqual([
      'Code Demo',
      'Product Launch',
      'Tutorial',
      'Livestream',
      'Minimal Desk',
      'Podcast',
      'Webinar',
      'Dark Mode',
      'Light Mode',
      'Focus'
    ])
    expect(registry.slots.every((slot) => slot.assetId === null && slot.status === 'empty')).toBe(
      true
    )
    expect(registry.activeSlotId).toBeNull()
    expect(registry.assets).toEqual({})
  })

  it('names a placeholder by its label and an imported slot by its asset name', () => {
    const placeholder = createDefaultRegistry()
    expect(slotName(slotById(placeholder, 'bg-03'), placeholder)).toBe('Tutorial')

    const ready = withReadySlot(placeholder, 'bg-03', readyAsset('asset-1', 'Sunset Ridge'))
    expect(slotName(slotById(ready, 'bg-03'), ready)).toBe('Sunset Ridge')
  })

  it('only lets ready slots be applied', () => {
    const ready = withReadySlot(createDefaultRegistry(), 'bg-03', readyAsset('asset-1', 'Sunset'))
    expect(canApplySlot(slotById(ready, 'bg-01'))).toBe(false)
    expect(canApplySlot(slotById(ready, 'bg-03'))).toBe(true)
  })

  it('derives active state from the registry, not from selection', () => {
    const ready = withReadySlot(createDefaultRegistry(), 'bg-03', readyAsset('asset-1', 'Sunset'))
    // Before Apply the ready slot reads as 'ready', not 'active'.
    expect(slotDisplayStatus(slotById(ready, 'bg-03'), ready)).toBe('ready')

    const applied = applySlot(ready, 'bg-03')
    expect(applied.activeSlotId).toBe('bg-03')
    expect(slotDisplayStatus(slotById(applied, 'bg-03'), applied)).toBe('active')
  })

  it('refuses to apply an empty placeholder slot', () => {
    const registry = createDefaultRegistry()
    expect(applySlot(registry, 'bg-01')).toBe(registry)
    expect(applySlot(registry, 'bg-01').activeSlotId).toBeNull()
  })

  it('moves the active marker on re-apply and clears it on demand', () => {
    let registry = withReadySlot(createDefaultRegistry(), 'bg-03', readyAsset('asset-1', 'Sunset'))
    registry = withReadySlot(registry, 'bg-07', readyAsset('asset-2', 'Studio Wall'))

    registry = applySlot(registry, 'bg-03')
    registry = applySlot(registry, 'bg-07')
    expect(registry.activeSlotId).toBe('bg-07')

    registry = clearActiveSlot(registry)
    expect(registry.activeSlotId).toBeNull()
  })

  describe('reconcileRegistry', () => {
    it('returns the default registry for missing or malformed storage', () => {
      expect(reconcileRegistry(null).slots).toHaveLength(10)
      expect(reconcileRegistry(undefined).activeSlotId).toBeNull()
      expect(reconcileRegistry('garbage').slots).toHaveLength(10)
      expect(reconcileRegistry(42).slots.map((slot) => slot.id)).toContain('bg-10')
    })

    it('drops an active selection that does not point at a ready slot', () => {
      // bg-01 is an empty placeholder, so a persisted active pointing at it is stale.
      expect(reconcileRegistry({ activeSlotId: 'bg-01' }).activeSlotId).toBeNull()
      expect(reconcileRegistry({ activeSlotId: 'does-not-exist' }).activeSlotId).toBeNull()
    })

    it('always rebuilds the ten canonical slots from code', () => {
      const reconciled = reconcileRegistry({
        slots: [{ id: 'bg-99', defaultLabel: 'Hacked', assetId: null, status: 'empty' }]
      })
      expect(reconciled.slots).toHaveLength(10)
      expect(reconciled.slots.map((slot) => slot.id)).not.toContain('bg-99')
      expect(reconciled.slots[0].defaultLabel).toBe('Code Demo')
    })
  })
})
