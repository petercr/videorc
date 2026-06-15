import { CheckCircle, ImageSquare } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ComponentProps, type ReactElement } from 'react'

import { PanelSection } from '@/components/panel-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  applySlot,
  canApplySlot,
  reconcileRegistry,
  slotDisplayStatus,
  slotName,
  type BackgroundAssetRegistry,
  type BackgroundAssetSlot,
  type BackgroundAssetSlotStatus
} from '@/lib/background-assets'
import { STORAGE_KEYS, loadJson } from '@/lib/capture'
import { cn } from '@/lib/utils'

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>

const STATUS_BADGE: Record<BackgroundAssetSlotStatus, { label: string; variant: BadgeVariant }> = {
  empty: { label: 'Empty', variant: 'outline' },
  ready: { label: 'Ready', variant: 'secondary' },
  active: { label: 'Active', variant: 'success' },
  'missing-file': { label: 'File missing', variant: 'warning' },
  unsupported: { label: 'Unsupported', variant: 'destructive' }
}

// Assets owns reusable background presets; Scene owns which one is active. Slice
// A2 renders the fixed ten-slot grid with selection and a read-only inspector.
// Every slot is an empty placeholder until import lands (A4), so Apply is present
// but disabled — selecting a tile only inspects it, it never applies.
export function AssetsTab(): ReactElement {
  const [registry, setRegistry] = useState<BackgroundAssetRegistry>(() =>
    reconcileRegistry(loadJson(STORAGE_KEYS.backgroundAssets, null))
  )
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.backgroundAssets, JSON.stringify(registry))
  }, [registry])

  const selectedSlot = useMemo(
    () => registry.slots.find((slot) => slot.id === selectedSlotId) ?? null,
    [registry.slots, selectedSlotId]
  )

  const applySelected = (): void => {
    if (!selectedSlot) {
      return
    }
    setRegistry((current) => applySlot(current, selectedSlot.id))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Assets</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Reusable background presets for your scenes. Select a slot to inspect it; applying sets
          the active scene background. Image import and inspector controls arrive in the next
          updates.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <PanelSection
          title="Background presets"
          icon={ImageSquare}
          description={`${registry.slots.length} curated slots`}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {registry.slots.map((slot) => (
              <PresetTile
                key={slot.id}
                slot={slot}
                registry={registry}
                selected={slot.id === selectedSlotId}
                onSelect={() => setSelectedSlotId(slot.id)}
              />
            ))}
          </div>
        </PanelSection>

        <BackgroundInspector slot={selectedSlot} registry={registry} onApply={applySelected} />
      </div>
    </div>
  )
}

function PresetTile({
  slot,
  registry,
  selected,
  onSelect
}: {
  slot: BackgroundAssetSlot
  registry: BackgroundAssetRegistry
  selected: boolean
  onSelect: () => void
}): ReactElement {
  const status = slotDisplayStatus(slot, registry)
  const name = slotName(slot, registry)
  const active = status === 'active'

  return (
    <button
      type="button"
      aria-pressed={selected}
      title={name}
      onClick={onSelect}
      className={cn(
        'group relative flex aspect-[16/9] items-end overflow-hidden rounded-lg border text-left transition-colors',
        selected
          ? 'border-primary ring-1 ring-primary/60'
          : 'border-border hover:border-foreground/30'
      )}
    >
      <span className="absolute inset-0 grid place-items-center bg-muted/30">
        <ImageSquare className="size-6 text-muted-foreground/40" weight="duotone" />
      </span>
      {active ? (
        <CheckCircle weight="fill" className="absolute right-1.5 top-1.5 size-4 text-success" />
      ) : null}
      <span className="relative z-10 w-full truncate bg-gradient-to-t from-background/95 via-background/70 to-transparent px-2 pb-1.5 pt-5 text-xs font-medium">
        {name}
      </span>
    </button>
  )
}

function BackgroundInspector({
  slot,
  registry,
  onApply
}: {
  slot: BackgroundAssetSlot | null
  registry: BackgroundAssetRegistry
  onApply: () => void
}): ReactElement {
  if (!slot) {
    return (
      <PanelSection title="Inspector" icon={ImageSquare}>
        <Empty className="py-10">
          <EmptyMedia variant="icon">
            <ImageSquare weight="duotone" />
          </EmptyMedia>
          <EmptyTitle>No background selected</EmptyTitle>
          <EmptyDescription>Select a preset slot to inspect it.</EmptyDescription>
        </Empty>
      </PanelSection>
    )
  }

  const status = slotDisplayStatus(slot, registry)
  const name = slotName(slot, registry)
  const badge = STATUS_BADGE[status]
  const applyable = canApplySlot(slot)
  const active = status === 'active'

  return (
    <PanelSection title="Inspector" icon={ImageSquare}>
      <div className="grid aspect-[16/9] place-items-center overflow-hidden rounded-lg border bg-muted/30">
        <ImageSquare className="size-8 text-muted-foreground/40" weight="duotone" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <Button className="w-full" disabled={!applyable || active} onClick={onApply}>
        {active ? 'Applied to scene' : 'Apply to scene'}
      </Button>
      {!applyable ? (
        <p className="text-xs text-muted-foreground">
          Import an image into this slot to apply it. Image import lands in the next update.
        </p>
      ) : null}
    </PanelSection>
  )
}
