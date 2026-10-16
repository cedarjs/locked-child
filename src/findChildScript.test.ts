import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { findChildScript } from './findChildScript.ts'

let app: string

const touch = (...segments: string[]) => {
  const file = path.join(app, ...segments)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '')
  return file
}

before(() => {
  app = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-find-child-')),
  )
})

after(() => {
  fs.rmSync(app, { recursive: true, force: true })
})

describe('findChildScript', () => {
  it('finds the script next to its caller, built or from source', () => {
    const built = touch('api', 'dist', 'lib', 'resize.child.js')
    const source = touch('api', 'src', 'lib', 'resize.child.ts')

    assert.equal(findChildScript(path.dirname(built), 'resize.child'), built)
    assert.equal(findChildScript(path.dirname(source), 'resize.child'), source)
  })

  it("finds a bundled build's script from wherever the bundle runs", () => {
    const bundled = touch(
      'api',
      'dist',
      'ud',
      'locked-children',
      'render.child.js',
    )

    // cedar serve --ud: the entry and its chunks
    for (const dir of [
      path.join(app, 'api', 'dist', 'ud'),
      path.join(app, 'api', 'dist', 'ud', 'chunks'),
      // Netlify bundles the build again, into its function's folder
      path.join(app, 'web', '.netlify', 'v1', 'functions'),
    ]) {
      assert.equal(findChildScript(dir, 'render.child'), bundled)
    }
  })

  it('throws when there is no such script', () => {
    assert.throws(
      () =>
        findChildScript(path.join(app, 'api', 'dist', 'lib'), 'missing.child'),
      /no missing\.child\.js or missing\.child\.ts in/,
    )
  })
})
