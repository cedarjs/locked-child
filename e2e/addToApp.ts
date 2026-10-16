/**
 * Adds this package (from a packed tarball) to a Cedar app the way its
 * README says to, and the e2e function (e2e/app) with its locked children,
 * and sharp, which one of the children uses. Run it after `cedar setup
 * deploy netlify --ud` or `vercel --ud`.
 *
 * Usage: node e2e/addToApp.ts <path-to-app> <path-to-package-tarball>
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [appArg, tarballArg] = process.argv.slice(2)
if (!appArg || !tarballArg) {
  console.error('Usage: node e2e/addToApp.ts <path-to-app> <path-to-tarball>')
  process.exit(1)
}

const appDir = path.resolve(appArg)
const tarball = path.resolve(tarballArg)
const repoRoot = path.join(import.meta.dirname, '..')

const yarn = (...args: string[]) =>
  execFileSync('yarn', args, {
    cwd: appDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

fs.cpSync(path.join(import.meta.dirname, 'app'), appDir, { recursive: true })

// The sharp version this package is tested with
const { devDependencies } = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
)
const sharpVersion: string = devDependencies.sharp

yarn(
  'workspace',
  'api',
  'add',
  `@cedarjs/locked-child@file:${tarball}`,
  `sharp@${sharpVersion}`,
)
yarn('workspace', 'web', 'add', '-D', `@cedarjs/locked-child@file:${tarball}`)

const viteConfig = path.join(appDir, 'web', 'vite.config.ts')
const config = fs.readFileSync(viteConfig, 'utf8')
if (!config.includes('plugins: [') || !/^import /m.test(config)) {
  throw new Error(`No \`plugins: [\` or imports in ${viteConfig}:\n${config}`)
}
// First in the list, where it's most likely to run too early: it must
// still copy the children into Vercel's functions after they're built
fs.writeFileSync(
  viteConfig,
  config
    .replace(
      /^import /m,
      "import { lockedChild } from '@cedarjs/locked-child/vite'\nimport ",
    )
    .replace('plugins: [', 'plugins: [lockedChild(), '),
)

// Netlify ships only the files it can trace from the API's imports
const netlifyToml = path.join(appDir, 'netlify.toml')
if (fs.existsSync(netlifyToml)) {
  const includedFiles = 'included_files = ["api/dist/ud/locked-children/**"]'
  const toml = fs.readFileSync(netlifyToml, 'utf8')
  if (!/^\[functions\]$/m.test(toml)) {
    throw new Error(`No [functions] in ${netlifyToml}:\n${toml}`)
  }
  fs.writeFileSync(
    netlifyToml,
    /^included_files = .*$/m.test(toml)
      ? toml.replace(/^included_files = .*$/m, includedFiles)
      : toml.replace(/^\[functions\]$/m, `[functions]\n${includedFiles}`),
  )
}
