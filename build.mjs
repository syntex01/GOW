import { build, context } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const outdir = path.join(root, 'dist')

const args = new Set(process.argv.slice(2))
const watch = args.has('--watch')
const serve = args.has('--serve')
const dev = watch || serve

/** Copy static files that do not depend on the bundle. */
async function copyStatic() {
  await mkdir(outdir, { recursive: true })
  await cp(path.join(root, 'src/assets'), path.join(outdir, 'assets'), { recursive: true })
  await cp(path.join(root, 'src/pwa/manifest.json'), path.join(outdir, 'manifest.json'))
  if (existsSync(path.join(root, 'src/favicon.ico'))) {
    await cp(path.join(root, 'src/favicon.ico'), path.join(outdir, 'favicon.ico'))
  }
}

/**
 * Writes index.html and sw.js with this build's identity stamped into them.
 *
 * Has to happen AFTER the bundle exists, because the identity is a hash of it.
 * Both files need it for the same reason: without a version in the URL the
 * browser serves whatever it cached, and without a version in the cache name
 * the service worker keeps its old entries forever. That combination shipped,
 * and it made every update invisible to anyone who had opened the game once —
 * they saw the previous build no matter how many times they reinstalled.
 */
async function stampStatic() {
  const bundlePath = path.join(outdir, 'game.bundle.js')
  const version = existsSync(bundlePath)
    ? createHash('sha256').update(await readFile(bundlePath)).digest('hex').slice(0, 12)
    : 'dev'

  const sw = await readFile(path.join(root, 'src/pwa/sw.js'), 'utf8')
  await writeFile(path.join(outdir, 'sw.js'), sw.replace('__BUILD_ID__', version))

  const html = await readFile(path.join(root, 'src/index.html'), 'utf8')
  await writeFile(
    path.join(outdir, 'index.html'),
    html.replace(
      '<script src="./game.bundle.js"></script>',
      `<script>window.__gowBuild=${JSON.stringify(version)}</script>\n    <script src="./game.bundle.js?v=${version}"></script>`
    )
  )
  return version
}

const options = {
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  outfile: path.join(outdir, 'game.bundle.js'),
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  logLevel: 'info',
  // Phaser ships a prebuilt bundle, so only the environment flag needs defining.
  define: {
    'process.env.NODE_ENV': dev ? '"development"' : '"production"'
  }
}

await rm(outdir, { recursive: true, force: true })
await copyStatic()

if (dev) {
  await stampStatic()
  const ctx = await context(options)
  await ctx.watch()
  if (serve) {
    const { host, port } = await ctx.serve({ servedir: outdir, port: 8080, host: '0.0.0.0' })
    console.log(`\n  GOW dev server running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`)
  } else {
    console.log('\n  Watching for changes…\n')
  }
} else {
  await build(options)
  const version = await stampStatic()
  console.log(`\n  Production build written to dist/  (build ${version})\n`)
}
