// Renderer-side platform awareness. The main process reports the real
// platform through runtimeInfo.platform ('darwin' | 'win32' | 'linux' | …);
// components read it to pick OS-correct copy, permission flows, and keyboard
// glyphs. Defaults to 'darwin' only as a pre-runtimeInfo boot fallback — the
// value is replaced the moment runtimeInfo arrives.

export type AppPlatform = 'darwin' | 'win32' | 'other'

export function appPlatform(platform: string | undefined): AppPlatform {
  if (platform === 'darwin') {
    return 'darwin'
  }
  if (platform === 'win32') {
    return 'win32'
  }
  return 'other'
}

export function isMacPlatform(platform: string | undefined): boolean {
  return appPlatform(platform) === 'darwin'
}

export function isWindowsPlatform(platform: string | undefined): boolean {
  return appPlatform(platform) === 'win32'
}

/** Human name for the OS Settings app, for permission copy. */
export function osSettingsName(platform: string | undefined): string {
  switch (appPlatform(platform)) {
    case 'darwin':
      return 'System Settings'
    case 'win32':
      return 'Windows Settings'
    default:
      return 'system settings'
  }
}
