import React from 'react'
import ReactDOM from 'react-dom/client'

import { CommentsReader } from '@/components/comments-reader'
import { AppErrorBoundary } from '@/components/error-boundary'
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

// C2 seeds an empty reader; C3 wires the live snapshot through the IPC relay.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <CommentsReader snapshot={emptyLiveChatSnapshot(new Date().toISOString())} />
    </AppErrorBoundary>
  </React.StrictMode>
)
