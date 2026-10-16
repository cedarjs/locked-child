import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'
import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import {
  CHILDREN_DIR,
  copyChildrenIntoVercelFunctions,
  findChildScripts,
  vendorChildPackages,
} from './children.ts'
import type { ChildImports } from './children.ts'

/** The environment of Cedar's bundled API build (`cedar build --ud`) */
const UD_ENVIRONMENT = 'ssr'

/** The Vercel environment vite-plugin-vercel builds Node functions in */
const VERCEL_NODE_ENVIRONMENT = 'vercel_node'

/**
 * The Vite plugin for locked children in Cedar's bundled API build
 * (`cedar build --ud`, which Netlify and Vercel deploys use). Add it to
 * `web/vite.config.ts`, where Cedar's build finds it:
 *
 * ```ts
 * import { lockedChild } from '@cedarjs/locked-child/vite'
 *
 * export default defineConfig({
 *   plugins: [cedar(), cedarUniversalDeployPlugin(), lockedChild()],
 * })
 * ```
 *
 * A child script isn't imported by anything, so the plugin:
 *
 * - makes each `*.child.{ts,js,mts,mjs}` in `api/src` an entry of the
 *   build of its own, `api/dist/ud/locked-children/<name>.child.js`, and
 *   fails the build if one imports your app's own code;
 * - copies the packages the children import, and everything those depend
 *   on, into `api/dist/ud/locked-children/node_modules`;
 * - with vite-plugin-vercel, copies that folder into each Node function in
 *   `.vercel/output/functions`.
 *
 * `findChildScript()` finds the children there from code in the bundle.
 *
 * Other builds don't need it: a regular `cedar build` keeps each child
 * next to the code that runs it, and the child imports packages from your
 * app's own `node_modules`.
 */
export function lockedChild(): Plugin[] {
  const paths = getPaths()
  const udDir = path.join(paths.api.dist, 'ud')
  const children = findChildScripts(paths.api.src)
  const sources = new Set(
    Object.values(children).map((file) => normalizePath(file)),
  )
  let imports: ChildImports[] = []

  // Cedar can build other `ssr` environments too (the web side's, for
  // streaming SSR); the bundled API build is the one that writes udDir
  const isUdBuild = (outDir: string | undefined, root = process.cwd()) =>
    outDir !== undefined && path.resolve(root, outDir) === path.resolve(udDir)

  return [
    {
      name: 'locked-child:entries',
      apply: 'build',
      configEnvironment(name, options) {
        if (
          name !== UD_ENVIRONMENT ||
          Object.keys(children).length === 0 ||
          !isUdBuild(options.build?.outDir)
        ) {
          return
        }
        return { build: { rollupOptions: { input: children } } }
      },
    },
    {
      name: 'locked-child:vendor',
      apply: 'build',
      applyToEnvironment(env) {
        return (
          env.name === UD_ENVIRONMENT &&
          isUdBuild(env.config.build.outDir, env.config.root)
        )
      },
      generateBundle(_options, bundle) {
        imports = []
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk' || !chunk.facadeModuleId) {
            continue
          }
          const source = normalizePath(chunk.facadeModuleId)
          if (!sources.has(source)) {
            continue
          }

          const bundled = [...chunk.imports, ...chunk.dynamicImports].filter(
            (id) => id in bundle,
          )
          if (bundled.length > 0) {
            this.error(
              `${path.basename(source)} imports your app's own code ` +
                `(${bundled.join(', ')}). A locked child script may import ` +
                'only packages and Node builtins: it runs in a process that ' +
                "can't read the rest of your app.",
            )
          }

          imports.push({
            source,
            imports: [...chunk.imports, ...chunk.dynamicImports],
          })
        }
      },
      writeBundle(options) {
        if (imports.length === 0 || !options.dir) {
          return
        }
        vendorChildPackages(path.join(options.dir, CHILDREN_DIR), imports)
      },
    },
    {
      name: 'locked-child:vercel',
      apply: 'build',
      // vite-plugin-vercel builds its functions in a `post` buildApp hook
      // of its own. Plugins with `enforce: 'post'` run after it, wherever
      // the app lists this one
      enforce: 'post',
      buildApp: {
        order: 'post',
        async handler(builder) {
          const vercelNode = builder.environments[VERCEL_NODE_ENVIRONMENT]
          if (!vercelNode?.isBuilt || Object.keys(children).length === 0) {
            return
          }
          copyChildrenIntoVercelFunctions({
            appRoot: paths.base,
            childrenDir: path.join(udDir, CHILDREN_DIR),
            functionsDir: path.join(
              path.resolve(
                vercelNode.config.root,
                vercelNode.config.build.outDir,
              ),
              'functions',
            ),
          })
        },
      },
    },
  ]
}
