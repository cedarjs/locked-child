import assert from 'node:assert/strict'

interface Report {
  parentDns: string
  probe: {
    ok: boolean
    result: { results: Record<string, string>; env: string[] }
  }
  thumbnail: { ok: boolean; result: unknown }
}

/**
 * What `/.api/functions/lockedChild` (e2e/app) must report on a deployed
 * platform: the children ran, the pure-JS one reached nothing it
 * shouldn't, and the sharp one made a thumbnail
 */
export function assertLockedChildWorks(body: unknown) {
  assert.partialDeepStrictEqual(body, {
    probe: { ok: true },
    thumbnail: { ok: true },
  })
  // Its shape is what the partial match above just checked
  const { parentDns, probe, thumbnail } = body as Report

  // The function itself has the network, so a refusal in the child means
  // the child was refused, not that the network is down
  assert.equal(parentDns, 'resolved')

  // Only the child's own refusals count: the permission model's
  // ERR_ACCESS_DENIED (Node 25+), or the no-network preload's error and its
  // missing fetch (Node 24). A timeout or ENETUNREACH would mean the child
  // did reach for the network
  const refusal =
    /^refused: (ERR_ACCESS_DENIED|No network access in a locked child)/
  const { results } = probe.result
  assert.deepEqual(Object.keys(results).sort(), [
    'dns',
    'fetch',
    'read the server code',
    'tcp to a public host',
    'tcp to the metadata endpoint',
  ])
  assert.match(results['tcp to a public host'], refusal)
  assert.match(results['tcp to the metadata endpoint'], refusal)
  assert.match(
    results.fetch,
    /^refused: (ERR_ACCESS_DENIED|fetch is not defined)/,
  )
  assert.match(results.dns, refusal)
  assert.equal(results['read the server code'], 'refused: ERR_ACCESS_DENIED')
  assert.deepEqual(probe.result.env, [])

  assert.deepEqual(thumbnail.result, {
    format: 'webp',
    width: 8,
    height: 8,
    riff: 'RIFFWEBP',
  })
}
