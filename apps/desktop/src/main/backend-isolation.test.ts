import { describe, expect, it } from 'vitest'

import { backendIsolationEnv } from './backend-isolation'

describe('backendIsolationEnv', () => {
  it('adds nothing for a normal (non-isolated) launch', () => {
    expect(backendIsolationEnv({})).toEqual({})
    expect(backendIsolationEnv({ VIDEORC_APP_DATA_DIR: '  ' })).toEqual({})
  })

  it('pins backend sqlite + secrets inside the isolated app-data dir', () => {
    expect(backendIsolationEnv({ VIDEORC_APP_DATA_DIR: '/tmp/smoke/app-data' })).toEqual({
      VIDEORC_DATABASE_PATH: '/tmp/smoke/app-data/videorc.sqlite3',
      VIDEORC_SECRETS_PATH: '/tmp/smoke/app-data/videorc-secrets.json'
    })
  })

  it('falls back to the isolated user-data dir when only that is set', () => {
    expect(backendIsolationEnv({ VIDEORC_USER_DATA_DIR: '/tmp/probe/user-data' })).toEqual({
      VIDEORC_DATABASE_PATH: '/tmp/probe/user-data/videorc.sqlite3',
      VIDEORC_SECRETS_PATH: '/tmp/probe/user-data/videorc-secrets.json'
    })
  })

  it('respects explicit backend path overrides', () => {
    expect(
      backendIsolationEnv({
        VIDEORC_APP_DATA_DIR: '/tmp/smoke/app-data',
        VIDEORC_DATABASE_PATH: '/tmp/custom/db.sqlite'
      })
    ).toEqual({
      VIDEORC_SECRETS_PATH: '/tmp/smoke/app-data/videorc-secrets.json'
    })
    expect(
      backendIsolationEnv({
        VIDEORC_APP_DATA_DIR: '/tmp/smoke/app-data',
        VIDEORC_DATABASE_PATH: '/tmp/custom/db.sqlite',
        VIDEORC_SECRETS_PATH: '/tmp/custom/secrets.json'
      })
    ).toEqual({})
  })
})
