import { ArrowsClockwise, FolderOpen, GearSix, Image, VideoCamera } from '@phosphor-icons/react'
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { LayoutSettings, PreviewLiveStatus, RuntimeInfo } from '@/lib/backend'
import { cn } from '@/lib/utils'

const SIZE_FRACTION: Record<LayoutSettings['cameraSize'], string> = {
  small: '20%',
  medium: '26%',
  large: '34%'
}

function cameraBoxStyle(layout: LayoutSettings): CSSProperties {
  const margin = `${layout.cameraMargin / 16}rem`
  const style: CSSProperties = {
    width: SIZE_FRACTION[layout.cameraSize],
    aspectRatio: '16 / 9',
    position: 'absolute'
  }

  if (layout.cameraCorner.includes('top')) {
    style.top = margin
  } else {
    style.bottom = margin
  }
  if (layout.cameraCorner.includes('left')) {
    style.left = margin
  } else {
    style.right = margin
  }

  return style
}

export function PreviewStage({
  previewUrl,
  previewLoading,
  previewLiveStatus,
  layout,
  onRetry,
  onOpenPermissions,
  onRevealPermissionTarget,
  runtimeInfo,
  className
}: {
  previewUrl: string | null
  previewLoading: boolean
  previewLiveStatus: PreviewLiveStatus
  layout: LayoutSettings
  onRetry?: () => void
  onOpenPermissions?: () => void
  onRevealPermissionTarget?: () => void
  runtimeInfo?: RuntimeInfo | null
  className?: string
}): ReactElement {
  const [imageFailed, setImageFailed] = useState(false)
  const isLive = previewLiveStatus.state === 'live'
  const showUnavailable = previewLiveStatus.state === 'unavailable' || imageFailed
  const badgeLabel =
    previewLiveStatus.state === 'connecting'
      ? 'Connecting'
      : previewLiveStatus.state === 'reconnecting'
        ? 'Reconnecting'
        : isLive
          ? previewLiveStatus.source === 'recording-session'
            ? 'Recording live'
            : 'Live'
          : 'Unavailable'

  useEffect(() => {
    setImageFailed(false)
  }, [previewUrl])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-muted">
        {previewUrl && !imageFailed ? (
          <img
            alt="Selected scene preview"
            className="size-full object-contain"
            key={previewUrl}
            src={previewUrl}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            {showUnavailable ? (
              <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
                <Image className="size-10 text-muted-foreground/50" weight="duotone" />
                <p className="text-sm font-medium text-muted-foreground">
                  {imageFailed
                    ? 'Live preview stream could not be displayed.'
                    : (previewLiveStatus.message ?? 'Live preview unavailable.')}
                </p>
              </div>
            ) : (
              <VideoCamera className="size-10 text-muted-foreground/50" weight="duotone" />
            )}
            {!showUnavailable ? (
              <div
                className={cn(
                  'border-2 border-primary/60 bg-primary/10',
                  layout.cameraShape === 'circle' ? 'rounded-full' : 'rounded-md'
                )}
                style={cameraBoxStyle(layout)}
              />
            ) : null}
          </div>
        )}
        <Badge className="absolute top-2 left-2" variant={isLive ? 'success' : 'secondary'}>
          {previewLoading ? 'Connecting' : badgeLabel}
        </Badge>
      </div>
      {showUnavailable && (onRetry || onOpenPermissions) ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {onOpenPermissions ? (
              <Button size="sm" variant="outline" onClick={onOpenPermissions}>
                <GearSix data-icon="inline-start" />
                Open permissions
              </Button>
            ) : null}
            {runtimeInfo && !runtimeInfo.isPackaged && onRevealPermissionTarget ? (
              <Button size="sm" variant="outline" onClick={onRevealPermissionTarget}>
                <FolderOpen data-icon="inline-start" />
                Reveal Electron.app
              </Button>
            ) : null}
            {onRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <ArrowsClockwise data-icon="inline-start" />
                Retry preview
              </Button>
            ) : null}
          </div>
          {runtimeInfo && !runtimeInfo.isPackaged ? (
            <p className="text-xs text-muted-foreground">
              Dev mode needs Screen Recording permission for {runtimeInfo.permissionTargetName}. If it is not listed,
              add the revealed app manually, then relaunch.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
