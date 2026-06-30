import { app, Notification } from 'electron'
import electronUpdater from 'electron-updater'

import { safeConsole } from './safe-console'

const { autoUpdater } = electronUpdater

// Background auto-update for packaged, signed builds — OFF by default for the
// download-only beta. videorc-web does not serve an electron-updater feed yet:
// its download system is auth-gated (presigned per-user URLs), and a public
// update feed is a separate, deliberate piece of work. With no feed, checking
// would just hit a dead URL, so this is opt-in. Set VIDEORC_ENABLE_AUTO_UPDATE=1
// once the feed ships — updates then download in the background and apply on the
// NEXT quit (autoInstallOnAppQuit), never a forced restart, so a recording is
// never cut off.
export function initAutoUpdater(): void {
  if (!app.isPackaged || process.env.VIDEORC_ENABLE_AUTO_UPDATE !== '1') {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    safeConsole.log(`[auto-update] ${info.version} available; downloading in the background.`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    safeConsole.log(`[auto-update] ${info.version} downloaded; will apply on next quit.`)
    // Non-blocking heads-up. We deliberately do not prompt to restart — the
    // update lands on the next natural quit so it can never interrupt a capture.
    if (Notification.isSupported()) {
      new Notification({
        title: `Videorc ${info.version} is ready`,
        body: 'It will be applied the next time you quit Videorc.',
        silent: true
      }).show()
    }
  })

  autoUpdater.on('error', (error) => {
    // Update failures are non-fatal and invisible to the user.
    safeConsole.warn(
      `[auto-update] error: ${error instanceof Error ? error.message : String(error)}`
    )
  })

  void autoUpdater.checkForUpdates().catch((error) => {
    safeConsole.warn(
      `[auto-update] check failed: ${error instanceof Error ? error.message : String(error)}`
    )
  })
}
