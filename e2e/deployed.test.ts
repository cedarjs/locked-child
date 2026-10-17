import assert from 'node:assert/strict'
import { it } from 'node:test'

import { assertLockedChildWorks } from './checks.ts'

const deployUrl = (process.env.DEPLOY_URL ?? '').replace(/\/+$/, '')

/**
 * A production alias that was just assigned answers 404 for a few seconds,
 * until it reaches every edge location, so a 404 is tried again for up to a
 * minute
 */
async function fetchOnceDeployed(url: string) {
  const deadline = Date.now() + 60_000

  for (;;) {
    const res = await fetch(url)

    if (res.status !== 404 || Date.now() > deadline) {
      return res
    }

    await res.body?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
}

it('runs locked children with no network or environment, and sharp works', async () => {
  assert.ok(deployUrl, 'Set DEPLOY_URL to the deployed e2e app')

  const res = await fetchOnceDeployed(`${deployUrl}/.api/functions/lockedChild`)
  const text = await res.text()

  assert.equal(res.status, 200, text)
  assertLockedChildWorks(JSON.parse(text))
})
