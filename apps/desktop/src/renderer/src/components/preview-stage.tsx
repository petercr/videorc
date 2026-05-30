import { ArrowsClockwise, Image, VideoCamera } from '@phosphor-icons/react'
import type { CSSProperties, ReactElement } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { LayoutSettings, PreviewLiveStatus } from '@/lib/backend'
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
  className
}: {
  previewUrl: string | null
  previewLoading: boolean
  previewLiveStatus: PreviewLiveStatus
  layout: LayoutSettings
  onRetry?: () => void
  className?: string
}): ReactElement {
  const isLive = previewLiveStatus.state === 'live'
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

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-muted">
        {previewUrl ? (
          <img alt="Selected scene preview" className="size-full object-contain" key={previewUrl} src={previewUrl} />
        ) : (
          <div className="flex size-full items-center justify-center">
            {previewLiveStatus.state === 'unavailable' ? (
              <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
                <Image className="size-10 text-muted-foreground/50" weight="duotone" />
                <p className="text-sm font-medium text-muted-foreground">
                  {previewLiveStatus.message ?? 'Live preview unavailable.'}
                </p>
              </div>
            ) : (
              <VideoCamera className="size-10 text-muted-foreground/50" weight="duotone" />
            )}
            {previewLiveStatus.state !== 'unavailable' ? (
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
      {previewLiveStatus.state === 'unavailable' && onRetry ? (
        <Button className="self-start" size="sm" variant="outline" onClick={onRetry}>
          <ArrowsClockwise data-icon="inline-start" />
          Retry preview
        </Button>
      ) : null}
    </div>
  )
}
