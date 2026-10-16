import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createConcurrencyLimiter } from './concurrencyLimiter.ts'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe('createConcurrencyLimiter', () => {
  it('runs at most `max` at once, the rest in the order they came', async () => {
    const limit = createConcurrencyLimiter(2)
    const gates = Array.from({ length: 5 }, deferred)
    const started: number[] = []
    let running = 0
    let mostRunning = 0

    const all = Promise.all(
      gates.map((gate, i) =>
        limit(async () => {
          started.push(i)
          running += 1
          mostRunning = Math.max(mostRunning, running)
          await gate.promise
          running -= 1
          return i
        }),
      ),
    )

    await tick()
    assert.deepEqual(started, [0, 1])

    gates[1].resolve()
    await tick()
    assert.deepEqual(started, [0, 1, 2])

    gates.forEach((gate) => gate.resolve())
    assert.deepEqual(await all, [0, 1, 2, 3, 4])
    assert.deepEqual(started, [0, 1, 2, 3, 4])
    assert.equal(mostRunning, 2)
  })

  it('passes on a rejection and frees the slot', async () => {
    const limit = createConcurrencyLimiter(1)

    await assert.rejects(
      limit(() => Promise.reject(new Error('broken file'))),
      (e: unknown) => e instanceof Error && e.message.includes('broken file'),
    )
    assert.equal(await limit(() => Promise.resolve('next')), 'next')
  })

  it('refuses a limit that is not a positive integer', () => {
    assert.throws(() => createConcurrencyLimiter(0))
    assert.throws(() => createConcurrencyLimiter(1.5))
  })
})
