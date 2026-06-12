import { ChatCircle, X } from '@phosphor-icons/react'
import type { ReactElement } from 'react'

import { LiveChatPanel } from '@/components/live-chat-panel'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import type { LiveChatSnapshot } from '../../../shared/backend'

// The live-only chat rail (ux-ia plan, slice 6): chat exists ONLY while a
// streaming session runs — off-air the Studio has no chat surface at all.
export function LiveChatRail({
  snapshot,
  onClearLocal,
  onClose
}: {
  snapshot: LiveChatSnapshot
  onClearLocal: () => void
  onClose: () => void
}): ReactElement {
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 rounded-2xl border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <ChatCircle className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
        <span className="flex-1 text-sm font-medium">Live chat</span>
        <Kbd>⌘J</Kbd>
        <Button
          aria-label="Close live chat"
          className="size-7"
          size="icon"
          variant="ghost"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <LiveChatPanel snapshot={snapshot} onClearLocal={onClearLocal} />
    </aside>
  )
}
