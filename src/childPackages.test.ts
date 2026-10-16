import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import sharp from 'sharp'

import { childPackagePaths } from './childPackages.ts'
import { findChildScript } from './findChildScript.ts'
import { runLockedChild } from './runLockedChild.ts'
import { assertIncludes } from './testing.ts'

let tmp: string

before(() => {
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'locked-child-packages-')),
  )
})

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const writePackage = (
  dir: string,
  pkg: { name: string } & Record<string, unknown>,
) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
}

const link = (target: string, at: string) => {
  fs.mkdirSync(path.dirname(at), { recursive: true })
  fs.symlinkSync(target, at, 'junction')
}

/** A child script's path in a new app, and the app's node_modules */
const newApp = (name: string) => {
  const app = path.join(tmp, name)
  const script = path.join(app, 'api', 'src', 'lib', 'x.child.ts')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  return { script, nm: path.join(app, 'node_modules') }
}

describe('childPackagePaths', () => {
  it("finds packages whatever their exports allow, and only what's needed", () => {
    const { script, nm } = newApp('exports')
    // Doesn't export its package.json, and has only an import condition
    writePackage(path.join(nm, 'esm-only'), {
      name: 'esm-only',
      exports: { '.': { import: './index.mjs' } },
      dependencies: { helper: '1' },
    })
    writePackage(path.join(nm, 'helper'), { name: 'helper' })
    writePackage(path.join(nm, 'unrelated'), { name: 'unrelated' })

    assert.deepEqual(childPackagePaths(['esm-only'], script), [
      path.join(nm, 'esm-only'),
      path.join(nm, 'helper'),
    ])
  })

  it('finds a package installed under an alias', () => {
    const { script, nm } = newApp('alias')
    // "image-lib": "npm:real-image-lib@1"
    writePackage(path.join(nm, 'image-lib'), {
      name: 'real-image-lib',
      dependencies: { helper: '1' },
    })
    writePackage(path.join(nm, 'helper'), { name: 'helper' })

    assert.deepEqual(childPackagePaths(['image-lib'], script), [
      path.join(nm, 'image-lib'),
      path.join(nm, 'helper'),
    ])
  })

  it('gives each package the nested version it uses', () => {
    const { script, nm } = newApp('nested')
    writePackage(path.join(nm, 'p'), { name: 'p', version: '1.0.0' })
    writePackage(path.join(nm, 'q'), { name: 'q', dependencies: { p: '2' } })
    writePackage(path.join(nm, 'q', 'node_modules', 'p'), {
      name: 'p',
      version: '2.0.0',
    })

    assert.deepEqual(childPackagePaths(['q'], script), [
      path.join(nm, 'q'),
      path.join(nm, 'q', 'node_modules', 'p'),
    ])
    assert.ok(
      childPackagePaths(['p', 'q'], script).includes(path.join(nm, 'p')),
    )
  })

  it("follows pnpm's layout, at the linked and the real paths", () => {
    const { script, nm } = newApp('pnpm')
    const inStore = (id: string, name: string) =>
      path.join(nm, '.pnpm', id, 'node_modules', name)
    writePackage(inStore('q@1', 'q'), { name: 'q', dependencies: { p: '2' } })
    writePackage(inStore('p@2', 'p'), { name: 'p' })
    link(inStore('p@2', 'p'), inStore('q@1', 'p'))
    link(inStore('q@1', 'q'), path.join(nm, 'q'))

    assert.deepEqual(childPackagePaths(['q'], script), [
      path.join(nm, 'q'),
      inStore('q@1', 'q'),
      inStore('q@1', 'p'),
      inStore('p@2', 'p'),
    ])
  })

  it('skips optional dependencies that are not installed, and survives a cycle', () => {
    const { script, nm } = newApp('optional')
    writePackage(path.join(nm, 'native'), {
      name: 'native',
      dependencies: { cyclic: '1' },
      optionalDependencies: {
        'native-this-platform': '1',
        'native-other-platform': '1',
      },
      peerDependencies: { 'not-installed-peer': '1' },
    })
    writePackage(path.join(nm, 'native-this-platform'), {
      name: 'native-this-platform',
    })
    writePackage(path.join(nm, 'cyclic'), {
      name: 'cyclic',
      dependencies: { native: '1' },
    })

    assert.deepEqual(childPackagePaths(['native'], script), [
      path.join(nm, 'native'),
      path.join(nm, 'cyclic'),
      path.join(nm, 'native-this-platform'),
    ])
  })

  it("throws for a package or a regular dependency that isn't installed", () => {
    const { script, nm } = newApp('missing')
    writePackage(path.join(nm, 'lonely'), {
      name: 'lonely',
      dependencies: { gone: '1' },
    })

    assert.throws(
      () => childPackagePaths(['nope'], script),
      (e: unknown) =>
        e instanceof Error &&
        e.message.includes(`Can't find package "nope" (needed by x.child.ts)`),
    )
    assert.throws(
      () => childPackagePaths(['lonely'], script),
      (e: unknown) =>
        e instanceof Error &&
        e.message.includes(`Can't find package "gone" (needed by lonely)`),
    )
  })

  it('includes the package.json path Node checks in node_modules folders on its way to a package, not the folders', () => {
    const { script, nm } = newApp('passed')
    writePackage(path.join(nm, 'lib-a'), { name: 'lib-a' })
    // What Vite and Vitest leave in api/node_modules: no packages, a cache
    const apiNm = path.join(path.dirname(nm), 'api', 'node_modules')
    fs.mkdirSync(path.join(apiNm, '.vite'), { recursive: true })

    const paths = childPackagePaths(['lib-a'], script)

    assert.ok(paths.includes(path.join(apiNm, 'lib-a', 'package.json')))
    assert.ok(paths.includes(path.join(nm, 'lib-a')))
    assert.ok(!paths.includes(apiNm))
    assert.ok(!paths.includes(nm))
  })
})

// A CommonJS lookup in the child (`require()`, `require.resolve()` — what
// pdf.js does for its canvas, and a CJS package for its own dependencies)
// stats every node_modules folder on its way. Under the permission model
// one that exists but isn't readable throws ERR_ACCESS_DENIED instead of
// being passed over — and Vite and Vitest make api/node_modules locally.
describe('require() in a locked child', () => {
  let lib: string

  before(() => {
    const app = path.join(tmp, 'require-app')
    lib = path.join(app, 'api', 'src', 'lib')
    fs.mkdirSync(lib, { recursive: true })
    const pkg = path.join(app, 'node_modules', 'cjs-lib')
    writePackage(pkg, { name: 'cjs-lib', main: 'index.js' })
    fs.writeFileSync(path.join(pkg, 'index.js'), "exports.hello = 'hi'")
    const vite = path.join(app, 'api', 'node_modules', '.vite')
    fs.mkdirSync(vite, { recursive: true })
    fs.writeFileSync(path.join(vite, 'cache.json'), '{}')
    fs.writeFileSync(
      path.join(lib, 'require.child.ts'),
      `import fs from 'node:fs'
       import { createRequire } from 'node:module'
       const require = createRequire(import.meta.url)
       require.resolve('cjs-lib/package.json')
       process.stdout.write(require('cjs-lib').hello)
       try {
         fs.readFileSync(${JSON.stringify(path.join(vite, 'cache.json'))})
         process.stdout.write(' and read the cache')
       } catch {}`,
    )
  })

  it('finds its package past an api/node_modules holding only a cache', async () => {
    const result = await runLockedChild({
      script: findChildScript(lib, 'require.child'),
      packages: ['cjs-lib'],
      input: Buffer.alloc(0),
    })

    assert.equal(result.ok ? '' : result.stderr, '')
    assert.equal(result.ok && result.output.toString(), 'hi')
  })
})

/** This repo's own node_modules, where sharp is installed */
const repoNodeModules = () => {
  let dir = import.meta.dirname
  while (!fs.existsSync(path.join(dir, 'node_modules', 'sharp'))) {
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error('sharp is not installed')
    }
    dir = parent
  }
  return fs.realpathSync(path.join(dir, 'node_modules'))
}

// A real native library in the child, in an app laid out like a Cedar app:
// node_modules links sharp (installed elsewhere, like a symlinked store),
// the web side and a workspace package. These fail when sharp changes how
// it's packaged or Node changes its permission model, before an app using
// the child finds out in production.
describe('sharp in a locked child', () => {
  let app: string
  let lib: string

  before(() => {
    app = path.join(tmp, 'sharp-app')
    lib = path.join(app, 'api', 'src', 'lib')
    fs.mkdirSync(lib, { recursive: true })
    const nm = path.join(app, 'node_modules')
    link(path.join(repoNodeModules(), 'sharp'), path.join(nm, 'sharp'))
    fs.mkdirSync(path.join(app, 'web', 'src'), { recursive: true })
    link(path.join(app, 'web'), path.join(nm, 'web'))
    writePackage(path.join(app, 'packages', 'shared'), { name: '@app/shared' })
    link(path.join(app, 'packages', 'shared'), path.join(nm, '@app', 'shared'))

    fs.writeFileSync(path.join(app, '.env'), 'DATABASE_URL=postgres://secret')
    fs.writeFileSync(path.join(app, 'web', '.env'), 'WEB_SECRET=1')
    fs.writeFileSync(path.join(app, 'web', 'src', 'App.tsx'), 'web source')
    fs.writeFileSync(
      path.join(app, 'packages', 'shared', 'index.js'),
      'shared source',
    )

    // The documented form: a .ts child next to its caller, with a bare
    // import, run by Node stripping its types
    fs.writeFileSync(
      path.join(lib, 'thumbnail.child.ts'),
      `import sharp from 'sharp'

       const chunks: Buffer[] = []
       for await (const chunk of process.stdin) {
         chunks.push(chunk)
       }
       const size: number = Number(process.argv[2])
       process.stdout.write(
         await sharp(Buffer.concat(chunks)).resize(size, size).webp().toBuffer())`,
    )

    const reads = {
      appEnv: path.join(app, '.env'),
      webEnvThroughLink: path.join(nm, 'web', '.env'),
      webSource: path.join(app, 'web', 'src', 'App.tsx'),
      workspacePackage: path.join(app, 'packages', 'shared', 'index.js'),
      workspacePackageThroughLink: path.join(nm, '@app', 'shared', 'index.js'),
    }
    fs.writeFileSync(
      path.join(lib, 'reads.child.mjs'),
      `import fs from 'node:fs'
       const got = {}
       for (const [name, file] of Object.entries(${JSON.stringify(reads)})) {
         try {
           got[name] = fs.readFileSync(file, 'utf8')
         } catch (e) {
           got[name] = e.code
         }
       }
       process.stdout.write(JSON.stringify(got))`,
    )
  })

  const png = () =>
    sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

  it('resizes an image in a .ts child with a bare import', async () => {
    const result = await runLockedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      packages: ['sharp'],
      allowAddons: true,
      input: await png(),
      args: ['4'],
      timeoutMs: 20_000,
    })

    assert.equal(result.ok ? '' : result.stderr, '')
    const output = result.ok ? result.output : Buffer.alloc(0)
    const { width, format } = await sharp(output).metadata()
    assert.deepEqual([format, width], ['webp', 4])
  })

  it("can't read .env, nor the other workspaces, directly or through node_modules", async () => {
    const result = await runLockedChild({
      script: path.join(lib, 'reads.child.mjs'),
      packages: ['sharp'],
      input: Buffer.alloc(0),
    })

    assert.deepEqual(
      result.ok ? JSON.parse(result.output.toString()) : result,
      {
        appEnv: 'ERR_ACCESS_DENIED',
        webEnvThroughLink: 'ERR_ACCESS_DENIED',
        webSource: 'ERR_ACCESS_DENIED',
        workspacePackage: 'ERR_ACCESS_DENIED',
        workspacePackageThroughLink: 'ERR_ACCESS_DENIED',
      },
    )
  })

  it('cannot load sharp without allowAddons', async () => {
    const result = await runLockedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      packages: ['sharp'],
      input: await png(),
      args: ['4'],
      timeoutMs: 20_000,
    })

    assert.partialDeepStrictEqual(result, { ok: false, failure: 'exit' })
    assertIncludes(!result.ok && result.stderr, 'ERR_DLOPEN_DISABLED')
  })

  it('cannot load sharp unless it is one of the packages', async () => {
    const result = await runLockedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      allowAddons: true,
      input: await png(),
      args: ['4'],
      timeoutMs: 20_000,
    })

    assert.partialDeepStrictEqual(result, { ok: false, failure: 'exit' })
  })

  it("is a spawn-error when a package isn't installed", async () => {
    const result = await runLockedChild({
      script: findChildScript(lib, 'thumbnail.child'),
      packages: ['not-installed-anywhere'],
      input: Buffer.alloc(0),
    })

    assert.partialDeepStrictEqual(result, { ok: false, failure: 'spawn-error' })
    assertIncludes(!result.ok && result.message, 'not-installed-anywhere')
  })
})
