/**
 * Startup self-test — proves the vendored bundle is intact before serving.
 * Build-time tests prove the source; this proves the artifact actually being
 * served (replicates OpenISD's AD-5 reasoning for its deployed bundle).
 *
 * Gates:
 *   1. Golden fixture: sealed-single sweep matches upstream's recorded SPL < 0.1 dB
 *   2. classifyFinite returns null on a healthy vented sweep (fixture)
 *   3. deriveDriver blocks an incomplete driver (validation alive at the boundary)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveDriver, sweep, classifyFinite } from '../vendor/dist/engine/index.js';
import type { BoxType, SweepParams, DriverRaw } from '../vendor/dist/engine/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'fixtures', 'golden');

interface Fixture {
  design: { driverRaw: DriverRaw; box: BoxType; P: SweepParams };
  sweep: { spl: number[] };
}

export function runSelfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Gate 1 — golden SPL match
  const f: Fixture = JSON.parse(readFileSync(join(FIXTURES, 'sealed-single.json'), 'utf8'));
  const { value: drv } = deriveDriver(f.design.driverRaw);
  if (!drv) {
    failures.push('deriveDriver rejected the known-good golden fixture driver');
  } else {
    const sw = sweep(drv, f.design.box, f.design.P);
    const maxDiff = Math.max(...sw.spl.map((v, i) => Math.abs(v - f.sweep.spl[i]!)));
    if (maxDiff >= 0.1) failures.push(`golden SPL drift: max |Δ| = ${maxDiff.toFixed(4)} dB (gate < 0.1 dB)`);
  }

  // Gate 2 — vented fixture sweep is finite
  const fv: Fixture = JSON.parse(readFileSync(join(FIXTURES, 'vented-single.json'), 'utf8'));
  const dv = deriveDriver(fv.design.driverRaw).value;
  if (!dv) {
    failures.push('deriveDriver rejected the vented golden fixture driver');
  } else {
    const issue = classifyFinite(sweep(dv, fv.design.box, fv.design.P));
    if (issue) failures.push(`vented golden sweep not finite: ${issue.message}`);
  }

  // Gate 3 — validation alive
  const bad = deriveDriver({ Fs: 30 });
  if (bad.value !== null || !bad.errors.some(e => e.level === 'error'))
    failures.push('deriveDriver failed to block an incomplete driver');

  return { ok: failures.length === 0, failures };
}
