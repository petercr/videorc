import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import ReactDOM from 'react-dom/client'

import { CommentsReader } from '@/components/comments-reader'
import { AppErrorBoundary } from '@/components/error-boundary'
import type { LiveChatMessage, LiveChatSnapshot } from '@/lib/backend'
import { chatSendFailures, localEchoMessage, sendablePlatforms } from '@/lib/chat-send'
import type { ChatSendFailure } from '@/lib/chat-send'
import { emptyLiveChatSnapshot } from '@/lib/live-chat-view'
import '@/styles.css'

// Long-lived second window: drop React's dev perf-track measures, which buffer
// outside the V8 heap and leak over time (see videorc-react-dev-perf-track-leak).
if (import.meta.env.DEV && localStorage.getItem('videorc.reactPerfTrack') !== '1') {
  const nativeMeasure = performance.measure.bind(performance)
  performance.measure = (
    name: string,
    startOrOptions?: string | PerformanceMeasureOptions,
    endMark?: string
  ): PerformanceMeasure => {
    const detail =
      typeof startOrOptions === 'object' && startOrOptions !== null ? startOrOptions.detail : null
    if (detail && typeof detail === 'object' && 'devtools' in detail) {
      return undefined as unknown as PerformanceMeasure
    }
    return nativeMeasure(name, startOrOptions, endMark)
  }
}

// The window's data comes from the main renderer through the main-process relay
// (C3): seed from the cached snapshot, then follow live pushes; Clear routes back.
function CommentsWindowApp(): ReactElement {
  const [snapshot, setSnapshot] = useState<LiveChatSnapshot>(() =>
    emptyLiveChatSnapshot(new Date().toISOString())
  )
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  // Send-to-all state (S5): optimistic "You" echoes merged into the feed +
  // per-platform failures from the last send.
  const [echoes, setEchoes] = useState<LiveChatMessage[]>([])
  const [sendPending, setSendPending] = useState(false)
  const [sendFailures, setSendFailures] = useState<ChatSendFailure[]>([])
  const echoSequence = useRef(0)
  useEffect(() => {
    void window.videorc
      ?.getCommentsSnapshot?.()
      .then((initial) => initial && setSnapshot(initial))
      .catch(() => {})
    void window.videorc
      ?.getCommentsWindowState?.()
      .then((state) => state && setAlwaysOnTop(state.alwaysOnTop))
      .catch(() => {})
    const offSnapshot = window.videorc?.onCommentsSnapshot?.((next) => setSnapshot(next))
    const offState = window.videorc?.onCommentsWindowState?.((state) =>
      setAlwaysOnTop(state.alwaysOnTop)
    )
    // Which comment is on stream: seeded + followed via the main-process relay
    // (the main renderer owns the highlight lifecycle).
    void window.videorc
      ?.getCommentHighlightState?.()
      .then((state) => state && setHighlightedId(state.messageId))
      .catch(() => {})
    const offHighlight = window.videorc?.onCommentHighlightState?.((state) =>
      setHighlightedId(state.messageId)
    )
    const offSendResult = window.videorc?.onChatSendResult?.((results) => {
      setSendPending(false)
      setSendFailures(chatSendFailures(results))
    })
    return () => {
      offSnapshot?.()
      offState?.()
      offHighlight?.()
      offSendResult?.()
    }
  }, [])
  const sendTargets = sendablePlatforms(snapshot.providers)
  const feedSnapshot: LiveChatSnapshot =
    echoes.length > 0 ? { ...snapshot, messages: [...snapshot.messages, ...echoes] } : snapshot
  return (
    <CommentsReader
      snapshot={feedSnapshot}
      alwaysOnTop={alwaysOnTop}
      highlightedId={highlightedId}
      sendFailures={sendFailures}
      sendPending={sendPending}
      sendTargets={sendTargets}
      onClear={() => {
        setEchoes([])
        void window.videorc?.clearComments?.()
      }}
      onHighlight={(message: LiveChatMessage) =>
        void window.videorc?.sendCommentHighlight?.(message)
      }
      onSend={(text) => {
        echoSequence.current += 1
        setEchoes((current) => [
          ...current.slice(-19),
          localEchoMessage(text, echoSequence.current, new Date().toISOString())
        ])
        setSendPending(true)
        setSendFailures([])
        void window.videorc?.sendChatFromCommentsWindow?.(text)
      }}
      onToggleAlwaysOnTop={() => void window.videorc?.setCommentsWindowAlwaysOnTop?.(!alwaysOnTop)}
    />
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <CommentsWindowApp />
    </AppErrorBoundary>
  </React.StrictMode>
)
