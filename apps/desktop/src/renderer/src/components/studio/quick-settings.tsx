import {
  CaretDown,
  Layout as LayoutIcon,
  Microphone,
  Monitor,
  Record,
  SpeakerHigh,
  SpeakerSlash,
  type Icon
} from '@phosphor-icons/react'
import type { ReactElement, ReactNode } from 'react'

import { SourceSelect } from '@/components/source-select'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { VideoPresetSelectItems } from '@/components/video-preset-select-items'
import { useWorkspaceNav } from '@/components/workspace-nav'
import { useStudio } from '@/hooks/use-studio'
import type { LayoutPreset, VideoPreset } from '@/lib/backend'
import {
  buildCameraSources,
  buildCaptureSources,
  buildMicrophoneSources,
  capturePickerDevices,
  layoutPresetNeedsCamera,
  layoutPresetNeedsScreen
} from '@/lib/capture'

const QUICK_PRESETS: { id: LayoutPreset; label: string }[] = [
  { id: 'screen-camera', label: 'Screen + Cam' },
  { id: 'screen-only', label: 'Screen' },
  { id: 'camera-only', label: 'Camera' },
  { id: 'side-by-side', label: 'Side by side' }
]

function presetLabel(preset: LayoutPreset): string {
  return QUICK_PRESETS.find((entry) => entry.id === preset)?.label ?? preset
}

const TRIGGER_CLASS =
  'flex w-full items-center gap-2 rounded-row border bg-background px-2.5 py-1.5 text-sm transition-colors hover:bg-accent data-[state=open]:bg-accent'

/**
 * Quick Settings (SD2): four compact cards mirroring the controls that own
 * their own pages — Source, Mic, Layout, Output. They edit the SAME
 * captureConfig via the shared builders / setters (one state) and deep-link to
 * the full editor. Device + preset edits are off-air (disabled mid-session, as
 * on Sources); the live-safe actions kept from the old session strip are the
 * Layout preset switch and mic mute. The live mic VU lands in SD4's mixer.
 */
export function QuickSettings(): ReactElement {
  const {
    captureConfig,
    setCaptureConfig,
    deviceList,
    selectedCaptureDevice,
    selectedCamera,
    selectedMicrophone,
    applyCameraPreset,
    applyVideoPreset,
    layoutSwitchPending,
    entitlements,
    isSessionActive
  } = useStudio()
  const { openStudioPanel } = useWorkspaceNav()

  const captureDevices = capturePickerDevices(deviceList.devices)
  const cameras = deviceList.devices.filter((device) => device.kind === 'camera')
  const microphones = deviceList.devices.filter((device) => device.kind === 'microphone')
  const selectedCaptureId = captureConfig.sources.screenId ?? captureConfig.sources.windowId
  const hasCamera = Boolean(captureConfig.sources.cameraId)
  const hasScreen = Boolean(selectedCaptureId)
  const muted = captureConfig.audio.microphoneMuted
  const MuteIcon = muted ? SpeakerSlash : SpeakerHigh

  const sourceSummary = [
    selectedCaptureDevice?.name ?? 'No screen',
    selectedCamera?.name ?? 'No camera'
  ].join(' · ')

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* SOURCE — screen + camera, edited off-air; full picker on Sources. */}
      <QuickCard icon={Monitor} label="Source">
        <Popover>
          <PopoverTrigger className={TRIGGER_CLASS}>
            <span className="min-w-0 flex-1 truncate text-left font-medium">{sourceSummary}</span>
            <CaretDown className="size-3 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-72 flex-col gap-3 p-3">
            <SourceSelect
              allowNone
              devices={captureDevices}
              disabled={isSessionActive}
              label="Screen / window"
              value={selectedCaptureId}
              onChange={(captureId) =>
                setCaptureConfig((current) => ({
                  ...current,
                  sources: buildCaptureSources(current.sources, captureDevices, captureId)
                }))
              }
            />
            <SourceSelect
              allowNone
              devices={cameras}
              disabled={isSessionActive}
              label="Camera"
              value={captureConfig.sources.cameraId}
              onChange={(cameraId) =>
                setCaptureConfig((current) => ({
                  ...current,
                  sources: buildCameraSources(current.sources, cameras, cameraId)
                }))
              }
            />
            <ManageLink onClick={() => openStudioPanel('sources')}>Manage sources</ManageLink>
          </PopoverContent>
        </Popover>
      </QuickCard>

      {/* MIC — picker off-air; mute is live-safe. */}
      <QuickCard icon={Microphone} label="Mic">
        <Popover>
          <PopoverTrigger className={TRIGGER_CLASS}>
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {selectedMicrophone?.name ?? 'No microphone'}
            </span>
            {selectedMicrophone && muted ? (
              <SpeakerSlash className="size-3.5 shrink-0 text-warning" weight="fill" />
            ) : null}
            <CaretDown className="size-3 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-72 flex-col gap-3 p-3">
            <SourceSelect
              allowNone
              devices={microphones}
              disabled={isSessionActive}
              label="Microphone"
              value={captureConfig.sources.microphoneId}
              onChange={(microphoneId) =>
                setCaptureConfig((current) => ({
                  ...current,
                  sources: buildMicrophoneSources(current.sources, microphones, microphoneId)
                }))
              }
            />
            {selectedMicrophone ? (
              <Button
                aria-pressed={muted}
                size="sm"
                variant="outline"
                onClick={() =>
                  setCaptureConfig((current) => ({
                    ...current,
                    audio: { ...current.audio, microphoneMuted: !current.audio.microphoneMuted }
                  }))
                }
              >
                <MuteIcon className={muted ? 'text-warning' : undefined} data-icon="inline-start" />
                {muted ? 'Unmute microphone' : 'Mute microphone'}
              </Button>
            ) : null}
            <ManageLink onClick={() => openStudioPanel('sources')}>Audio settings</ManageLink>
          </PopoverContent>
        </Popover>
      </QuickCard>

      {/* LAYOUT — live-safe preset switch (the deliberate two-home control). */}
      <QuickCard icon={LayoutIcon} label="Layout">
        <Popover>
          <PopoverTrigger className={TRIGGER_CLASS}>
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {layoutSwitchPending ? 'Switching…' : presetLabel(captureConfig.layout.layoutPreset)}
            </span>
            <CaretDown className="size-3 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  disabled={
                    layoutSwitchPending !== null ||
                    (layoutPresetNeedsCamera(preset.id) && !hasCamera) ||
                    (layoutPresetNeedsScreen(preset.id) && !hasScreen)
                  }
                  size="sm"
                  variant={
                    captureConfig.layout.layoutPreset === preset.id ? 'secondary' : 'outline'
                  }
                  onClick={() => applyCameraPreset({ layoutPreset: preset.id })}
                >
                  {layoutSwitchPending === preset.id ? 'Switching…' : preset.label}
                </Button>
              ))}
            </div>
            <Separator className="my-2" />
            <ManageLink onClick={() => openStudioPanel('layouts')}>Edit scene</ManageLink>
          </PopoverContent>
        </Popover>
      </QuickCard>

      {/* OUTPUT — recording video preset, edited off-air. */}
      <QuickCard icon={Record} label="Output">
        <Select
          disabled={isSessionActive}
          value={captureConfig.video.preset}
          onValueChange={(value) => applyVideoPreset(value as VideoPreset, { kind: 'recording' })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <VideoPresetSelectItems entitlements={entitlements} kind="recording" />
          </SelectContent>
        </Select>
      </QuickCard>
    </div>
  )
}

function QuickCard({
  icon: CardIcon,
  label,
  children
}: {
  icon: Icon
  label: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-row bg-muted/30 p-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CardIcon className="size-3.5 shrink-0" weight="duotone" />
        {label}
      </span>
      {children}
    </div>
  )
}

function ManageLink({
  onClick,
  children
}: {
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <Button className="w-full justify-start" size="sm" variant="ghost" onClick={onClick}>
      {children}
    </Button>
  )
}
