/** Rename the already JS/CSS-inlined audit page for the user-facing handoff. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const source = join('dist', 'model-audit.html');
const output = join('dist', 'GrimdarkVisualAudit.html');
const html = readFileSync(source, 'utf8');
writeFileSync(output, html);
console.log(`${output}: ${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB; community models stream from their credited TTS URLs`);
