import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { backendIsolationEnv } from './backend-isolation'

describe('backendIsolationEnv', () => {
  it('adds nothing for a normal (non-isolated) launch', () => {
    expect(backendIsolationEnv({})).toEqual({})
    expect(backendIsolationEnv({ VIDEORC_APP_DATA_DIR: '  ' })).toEqual({})
  })

  it('pins backend sqlite + secrets + recordings inside the isolated app-data dir', () => {
    const appDataDir = '/tmp/smoke/app-data'
    expect(backendIsolationEnv({ VIDEORC_APP_DATA_DIR: '/tmp/smoke/app-data' })).toEqual({
      VIDEORC_DATABASE_PATH: join(appDataDir, 'videorc.sqlite3'),
      VIDEORC_SECRETS_PATH: join(appDataDir, 'videorc-secrets.json'),
      VIDEORC_RECORDINGS_DIR: join(appDataDir, 'recordings')
    })
  })

  it('falls back to the isolated user-data dir when only that is set', () => {
    const userDataDir = '/tmp/probe/user-data'
    expect(backendIsolationEnv({ VIDEORC_USER_DATA_DIR: userDataDir })).toEqual({
      VIDEORC_DATABASE_PATH: join(userDataDir, 'videorc.sqlite3'),
      VIDEORC_SECRETS_PATH: join(userDataDir, 'videorc-secrets.json'),
      VIDEORC_RECORDINGS_DIR: join(userDataDir, 'recordings')
    })
  })

  it('respects explicit backend path overrides', () => {
    const appDataDir = '/tmp/smoke/app-data'
    expect(
      backendIsolationEnv({
        VIDEORC_APP_DATA_DIR: appDataDir,
        VIDEORC_DATABASE_PATH: '/tmp/custom/db.sqlite'
      })
    ).toEqual({
      VIDEORC_SECRETS_PATH: join(appDataDir, 'videorc-secrets.json'),
      VIDEORC_RECORDINGS_DIR: join(appDataDir, 'recordings')
    })
    expect(
      backendIsolationEnv({
        VIDEORC_APP_DATA_DIR: '/tmp/smoke/app-data',
        VIDEORC_DATABASE_PATH: '/tmp/custom/db.sqlite',
        VIDEORC_SECRETS_PATH: '/tmp/custom/secrets.json',
        VIDEORC_RECORDINGS_DIR: '/tmp/custom/recordings'
      })
    ).toEqual({})
  })
})
