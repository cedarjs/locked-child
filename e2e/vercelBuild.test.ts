import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { it } from 'node:test'

// An app built for Vercel (`cedar build --ud` with vite-plugin-vercel) by the
// CI workflow, after e2e/addToApp.ts
const appDir = path.resolve(process.env.APP_DIR ?? '')
const functionsDir = path.join(appDir, '.vercel', 'output', 'functions')

const functionDirs = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) {
      return []
    }
    const entryPath = path.join(dir, entry.name)
    return entry.name.endsWith('.func') ? [entryPath] : functionDirs(entryPath)
  })

const runtimeOf = (dir: string): string =>
  JSON.parse(fs.readFileSync(path.join(dir, '.vc-config.json'), 'utf8')).runtime

it('copies the locked children into every Node function', () => {
  assert.ok(process.env.APP_DIR, 'Set APP_DIR to the built e2e app')

  const nodeFunctions = functionDirs(functionsDir).filter((dir) =>
    runtimeOf(dir).startsWith('nodejs'),
  )
  assert.ok(
    nodeFunctions.some((dir) => path.basename(dir).includes('lockedChild')),
    `No lockedChild function in ${functionsDir}`,
  )

  for (const dir of nodeFunctions) {
    const children = path.join(dir, 'api', 'dist', 'ud', 'locked-children')
    for (const file of [
      'probe.child.js',
      'thumbnail.child.js',
      path.join('node_modules', 'sharp', 'package.json'),
    ]) {
      assert.ok(
        fs.existsSync(path.join(children, file)),
        `No ${file} in ${children}`,
      )
    }
  }
})
