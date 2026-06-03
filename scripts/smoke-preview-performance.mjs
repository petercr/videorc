import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const previewStage = readFileSync(
  join(root, 'apps/desktop/src/renderer/src/components/preview-stage.tsx'),
  'utf8'
)
const useStudio = readFileSync(
  join(root, 'apps/desktop/src/renderer/src/hooks/use-studio.tsx'),
  'utf8'
)

assertIncludes(
  previewStage,
  'hasRetainedPreviewFrame',
  'PreviewStage should track whether it is showing a retained frame.'
)
assertNotIncludes(
  previewStage,
  'setDisplayPreviewUrl(null)',
  'PreviewStage must not blank the last good frame when previewUrl is temporarily null.'
)
assertIncludes(
  previewStage,
  "'Updating'",
  'PreviewStage should label retained-frame refreshes as Updating instead of blanking.'
)
assertIncludes(
  useStudio,
  'latestPreviewConfig',
  'refreshPreview should read the latest layout from a ref instead of depending on every layout render.'
)
assertIncludes(
  useStudio,
  'previewRestartKey',
  'Automatic preview restarts should be keyed separately from refreshPreview.'
)
assertNotMatches(
  previewRestartKeyBody(useStudio),
  /layout/,
  'Automatic live-preview restarts must not be keyed on pure layout edits.'
)
assertIncludes(
  useStudio,
  'sceneLoadRun',
  'Scene reload responses should be versioned so stale reloads cannot overwrite newer layout state.'
)
assertNotIncludes(
  refreshPreviewCatchBlock(useStudio),
  'setPreviewUrl(null)',
  'Preview refresh failures must not clear the retained preview URL.'
)

console.log('Preview performance smoke OK - retained frames, restart key, and stale response guards verified.')

function previewRestartKeyBody(source) {
  const match = source.match(/const previewRestartKey = useMemo\([\s\S]*?\n  \)/)
  if (!match) {
    throw new Error('Could not find previewRestartKey useMemo block.')
  }
  return match[0]
}

function refreshPreviewCatchBlock(source) {
  const match = source.match(/const refreshPreview = useCallback\([\s\S]*?\} catch \(error\) \{([\s\S]*?)\} finally \{/)
  if (!match) {
    throw new Error('Could not find refreshPreview catch block.')
  }
  return match[1]
}

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message)
  }
}

function assertNotIncludes(source, needle, message) {
  if (source.includes(needle)) {
    throw new Error(message)
  }
}

function assertNotMatches(source, pattern, message) {
  if (pattern.test(source)) {
    throw new Error(message)
  }
}

