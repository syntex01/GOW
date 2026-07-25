import { build, context } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const outdir = path.join(root, 'dist')

const args = new Set(process.argv.slice(2))
const watch = args.has('--watch')
const serve = args.has('--serve')
const dev = watch || serve

/** Copy static files that are referenced directly by index.html. */
async function copyStatic() {
  await mkdir(outdir, { recursive: true })
  await cp(path.join(root, 'src/assets'), path.join(outdir, 'assets'), { recursive: true })
  await cp(path.join(root, 'src/pwa/manifest.json'), path.join(outdir, 'manifest.json'))
  await cp(path.join(root, 'src/pwa/sw.js'), path.join(outdir, 'sw.js'))
  if (existsSync(path.join(root, 'src/favicon.ico'))) {
    await cp(path.join(root, 'src/favicon.ico'), path.join(outdir, 'favicon.ico'))
  }
  const html = await readFile(path.join(root, 'src/index.html'), 'utf8')
  await writeFile(path.join(outdir, 'index.html'), html)
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
  console.log('\n  Production build written to dist/\n')
}
