import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = await mkdtemp(path.join(tmpdir(), 'gow-carnage-check-'))
const outfile = path.join(dir, 'check.mjs')
try {
  await build({
    entryPoints: ['scripts/validate-carnage-roster.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning'
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(dir, { recursive: true, force: true })
}
