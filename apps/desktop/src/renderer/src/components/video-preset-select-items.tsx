import { LockKey } from '@phosphor-icons/react'
import type { ReactElement } from 'react'

import { SelectGroup, SelectItem, SelectLabel, SelectSeparator } from '@/components/ui/select'
import type { EntitlementsSnapshot } from '@/lib/backend'
import {
  customVideoPresetOption,
  legacyVideoPresetOptions,
  recordingVideoPresetOptions,
  streamingVideoPresetOptions,
  videoPresets,
  type VideoPresetOption
} from '@/lib/capture'
import { videoProfileEntitlementGate } from '@/lib/entitlement-ui'

export function VideoPresetSelectItems({
  entitlements,
  kind
}: {
  entitlements: EntitlementsSnapshot | null
  kind: 'recording' | 'streaming'
}): ReactElement {
  return (
    <SelectGroup>
      <SelectLabel>Recording</SelectLabel>
      {recordingVideoPresetOptions.map((option) => (
        <VideoPresetSelectItem
          entitlements={entitlements}
          key={option.value}
          kind={kind}
          option={option}
        />
      ))}
      <SelectSeparator />
      <SelectLabel>Streaming</SelectLabel>
      {streamingVideoPresetOptions.map((option) => (
        <VideoPresetSelectItem
          entitlements={entitlements}
          key={option.value}
          kind={kind}
          option={option}
        />
      ))}
      <SelectSeparator />
      <SelectLabel>Legacy</SelectLabel>
      {legacyVideoPresetOptions.map((option) => (
        <VideoPresetSelectItem
          entitlements={entitlements}
          key={option.value}
          kind={kind}
          option={option}
        />
      ))}
      <SelectSeparator />
      <SelectItem value={customVideoPresetOption.value}>{customVideoPresetOption.label}</SelectItem>
    </SelectGroup>
  )
}

function VideoPresetSelectItem({
  entitlements,
  kind,
  option
}: {
  entitlements: EntitlementsSnapshot | null
  kind: 'recording' | 'streaming'
  option: VideoPresetOption
}): ReactElement {
  const gate = videoProfileEntitlementGate({
    entitlements,
    kind,
    video: videoPresets[option.value]
  })

  return (
    <SelectItem
      className={option.tone === 'warning' ? 'text-warning' : undefined}
      disabled={!gate.allowed}
      title={gate.allowed ? undefined : gate.reason}
      value={option.value}
    >
      {option.label}
      {!gate.allowed ? (
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <LockKey className="size-3" weight="fill" />
          {gate.upgradeUrl ? 'Premium' : 'Locked'}
        </span>
      ) : null}
    </SelectItem>
  )
}
