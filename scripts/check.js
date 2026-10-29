// node --check every .js file (syntax check). © VR DEVELOPMENTS
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { if (['node_modules', '.git', '.vr'].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk('.');
let bad = 0;
for (const f of files) { const r = spawnSync(process.execPath, ['--check', f]); if (r.status !== 0) { bad++; console.error(`✗ ${f}\n${r.stderr}`); } }
console.log(`${files.length - bad}/${files.length} files OK`);
process.exit(bad ? 1 : 0);
