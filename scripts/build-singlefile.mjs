/**
 * Post-process the SINGLEFILE build into a truly self-contained, offline,
 * double-click-to-play HTML.
 *
 * vite-plugin-singlefile already inlines all JS + CSS into dist/index.html. But
 * the 3D figure models are GLBs fetched at runtime by relative path, which fails
 * from file://. This script base64-inlines those GLBs and injects a tiny fetch
 * shim (before the app script) that serves them from memory, so the finished
 * single HTML needs no web server and no network.
 *
 * Run after `SINGLEFILE=1 vite build`:
 *   node scripts/build-singlefile.mjs
 * Produces dist/GrimdarkTabletop.html.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
// Every runtime model directory to inline, keyed by the URL prefix the app
// fetches. Both the generic faction figures AND the per-unit datasheet models.
const MODELS_DIRS = ['models/factions', 'models/units'];

const htmlPath = join(DIST, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

// Collect every GLB and base64-encode it, keyed by the runtime path the app
// fetches (e.g. "models/factions/necron.glb", "models/units/trukk.glb").
const map = {};
let total = 0;
for (const dir of MODELS_DIRS) {
  for (const f of readdirSync(join('public', dir))) {
    if (!f.endsWith('.glb')) continue;
    const bytes = readFileSync(join('public', dir, f));
    total += bytes.length;
    map[`${dir}/${f}`] = bytes.toString('base64');
  }
}

// A self-installing fetch shim: when the app (GLTFLoader) fetches one of these
// model paths, return the inlined bytes instead of hitting the network/disk.
// Decodes base64 → ArrayBuffer and hands back a Response, so it is transparent
// to GLTFLoader. Falls through to the real fetch for anything else.
const shim = `<script>(function(){
  var GLB = ${JSON.stringify(map)};
  function b64ToBuf(b64){
    var bin = atob(b64), len = bin.length, u8 = new Uint8Array(len);
    for (var i=0;i<len;i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }
  var keys = Object.keys(GLB);
  function match(url){ for (var i=0;i<keys.length;i++){ if (url.indexOf(keys[i])!==-1) return keys[i]; } return null; }
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var k = match(url);
    if (k) return Promise.resolve(new Response(b64ToBuf(GLB[k]), { status:200, headers:{'Content-Type':'model/gltf-binary'} }));
    return _fetch ? _fetch(input, init) : Promise.reject(new Error('no network'));
  };
})();</script>`;

// Inject the shim as the FIRST thing in <head> so it patches fetch before the
// app module runs.
html = html.replace(/<head>/i, `<head>\n${shim}`);

const outPath = join(DIST, 'GrimdarkTabletop.html');
writeFileSync(outPath, html);

const mb = (Buffer.byteLength(html) / 1048576).toFixed(1);
console.log(
  `SINGLEFILE OK — ${outPath} (${mb} MB, ${Object.keys(map).length} models inlined, ${(total / 1048576).toFixed(1)} MB of GLB)`,
);
