import assert from 'node:assert/strict'
import { it } from 'node:test'

import { assertLockedChildWorks } from './checks.ts'

const deployUrl = (process.env.DEPLOY_URL ?? '').replace(/\/+$/, '')

it('runs locked children with no network or environment, and sharp works', async () => {
  assert.ok(deployUrl, 'Set DEPLOY_URL to the deployed e2e app')

  const res = await fetch(`${deployUrl}/.api/functions/lockedChild`)
  const text = await res.text()

  assert.equal(res.status, 200, text)
  assertLockedChildWorks(JSON.parse(text))
})
