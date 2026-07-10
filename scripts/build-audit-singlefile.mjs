/** Inline every gameplay GLB into the already JS/CSS-inlined audit page. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const modelDirs = ['models/factions', 'models/units'];
const models = {};
for (const dir of modelDirs) {
  for (const file of readdirSync(join('public', dir))) {
    if (file.endsWith('.glb')) models[`${dir}/${file}`] = readFileSync(join('public', dir, file)).toString('base64');
  }
}

const shim = `<script>(function(){
var M=${JSON.stringify(models)},F=window.fetch.bind(window);
window.fetch=function(i,n){var u=typeof i==='string'?i:(i&&i.url)||'',k=Object.keys(M).find(function(x){return u.indexOf(x)!==-1});
if(!k)return F(i,n);var b=atob(M[k]),a=new Uint8Array(b.length);for(var j=0;j<b.length;j++)a[j]=b.charCodeAt(j);
return Promise.resolve(new Response(a.buffer,{status:200,headers:{'Content-Type':'model/gltf-binary'}}));};
})();</script>`;
const source = join('dist', 'model-audit.html');
const output = join('dist', 'GrimdarkVisualAudit.html');
const html = readFileSync(source, 'utf8').replace(/<head>/i, `<head>${shim}`);
writeFileSync(output, html);
console.log(`${output}: ${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB, ${Object.keys(models).length} models`);
