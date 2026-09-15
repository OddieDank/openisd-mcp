#!/usr/bin/env node
// Build the driver search index from the vendored .wdr library.
// Runs as the last step of scripts/vendor.sh (needs vendor/dist compiled).
// Uses upstream's own parser (Driver.fromWdr) — no format logic of our own.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Driver } from '../vendor/dist/winisd/index.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'drivers');
const index = [];
let skipped = 0;

for (const f of readdirSync(dir).filter(f => f.endsWith('.wdr'))) {
  try {
    const d = Driver.fromWdr(readFileSync(join(dir, f), 'utf8'));
    const eng = d.toDriver();           // null when a blocking error exists
    if (!eng) { skipped++; continue; }
    const raw = d.raw();
    index.push({
      file: f,
      name: raw.name || f.replace(/\.wdr$/, ''),
      brand: raw.brand || '',
      model: raw.model || '',
      Fs: eng.Fs, Qts: eng.Qts, Qes: eng.Qes, Vas: eng.Vas,
      Sd: eng.Sd, Re: eng.Re,
      Xmax: eng.Xmax ?? null, Pe: eng.Pe ?? null,
    });
  } catch { skipped++; }
}

index.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
console.log(`>> Driver index: ${index.length} drivers (${skipped} skipped)`);
