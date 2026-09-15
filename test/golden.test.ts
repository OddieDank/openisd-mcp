// Golden-master regression: the vendored engine must reproduce upstream's own
// recorded fixtures exactly. Catches a broken/corrupted vendor at test time.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deriveDriver, sweep, maxCurves } from '../vendor/dist/engine/index.js';
import type { BoxType, SweepParams, DriverRaw } from '../vendor/dist/engine/index.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'fixtures', 'golden');

interface Fixture {
  design: { driverRaw: DriverRaw; box: BoxType; P: SweepParams };
  sweep: { spl: number[]; exc: number[]; zmag: number[] };
  maxCurves?: { maxspl: number[] };
}

function maxDiff(a: number[], b: number[]): number {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
}

const files = readdirSync(DIR).filter(f => f.endsWith('.json'));

describe('golden fixtures (upstream)', () => {
  for (const file of files) {
    it(file, () => {
      const f: Fixture = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
      const { value: drv, errors } = deriveDriver(f.design.driverRaw);
      expect(errors.filter(e => e.level === 'error')).toEqual([]);
      expect(drv).not.toBeNull();
      const sw = sweep(drv!, f.design.box, f.design.P);
      expect(maxDiff(sw.spl, f.sweep.spl)).toBeLessThan(1e-8);
      expect(maxDiff(sw.exc, f.sweep.exc)).toBeLessThan(1e-8);
      expect(maxDiff(sw.zmag, f.sweep.zmag)).toBeLessThan(1e-8);
      if (f.maxCurves) {
        const mc = maxCurves(drv!, f.design.box, f.design.P);
        expect(maxDiff(mc.maxspl, f.maxCurves.maxspl)).toBeLessThan(1e-8);
      }
    });
  }
});
