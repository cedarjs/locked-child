import assert from 'node:assert/strict'
import { inspect } from 'node:util'

const includes = (haystack: unknown, needle: unknown) =>
  (typeof haystack === 'string' &&
    typeof needle === 'string' &&
    haystack.includes(needle)) ||
  (Array.isArray(haystack) && haystack.includes(needle))

/** Fails unless `haystack`, a string or an array, includes `needle` */
export function assertIncludes(haystack: unknown, needle: unknown) {
  assert.ok(
    includes(haystack, needle),
    `Expected ${inspect(haystack)} to include ${inspect(needle)}`,
  )
}

/** Fails if `haystack`, a string or an array, includes `needle` */
export function assertExcludes(haystack: unknown, needle: unknown) {
  assert.ok(
    !includes(haystack, needle),
    `Expected ${inspect(haystack)} not to include ${inspect(needle)}`,
  )
}
