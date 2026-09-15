/**
 * Design orchestration — unit conversion, library access, stats extraction.
 * ZERO physics of our own: every number comes from the vendored OpenISD
 * engine (@openisd/engine) or its .wdr parser (@openisd/winisd). This file is
 * the MCP server's analogue of the Vue store: a headless driver over calc +
 * winisd, unchanged (ARCHITECTURE.md AD-6 litmus test).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveDriver, sweep, maxCurves, classifyFinite,
  ebp, sealedFromQtc, ventedAlignment, ventLength, tuningFromLength,
  END_CORRECTION,
} from '../vendor/dist/engine/index.js';
import type {
  DriverRaw, Driver, BoxType, SweepParams, SweepResult, MaxCurvesResult, DriverError,
} from '../vendor/dist/engine/index.js';
import { Driver as WdrDriver, toWdr } from '../vendor/dist/winisd/index.js';

const DRIVERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'drivers');

// ---------------------------------------------------------------------------
// Agent-facing T/S shape (friendly units) <-> engine DriverRaw (SI)
// ---------------------------------------------------------------------------

export interface FriendlyTS {
  name?: string;
  Fs: number;                 // Hz
  Qts?: number;
  Qes?: number;
  Qms?: number;
  Vas_l: number;              // litres (engine: m³)
  Sd_cm2: number;             // cm²  (engine: m²)
  Re: number;                 // ohm
  Le_mH?: number;             // mH   (engine: H)
  Xmax_mm?: number;           // mm   (engine: m)
  Pe?: number;                // W
}

export function toRaw(f: FriendlyTS): DriverRaw {
  return {
    name: f.name,
    Fs: f.Fs, Qts: f.Qts, Qes: f.Qes, Qms: f.Qms,
    Vas: f.Vas_l / 1000, Sd: f.Sd_cm2 / 1e4, Re: f.Re,
    Le: f.Le_mH != null ? f.Le_mH / 1000 : undefined,
    Xmax: f.Xmax_mm != null ? f.Xmax_mm / 1000 : undefined,
    Pe: f.Pe,
  };
}

export function toFriendly(d: DriverRaw): FriendlyTS {
  return {
    name: d.name,
    Fs: d.Fs!, Qts: d.Qts, Qes: d.Qes, Qms: d.Qms,
    Vas_l: d.Vas! * 1000, Sd_cm2: d.Sd! * 1e4, Re: d.Re!,
    Le_mH: d.Le != null ? d.Le * 1000 : undefined,
    Xmax_mm: d.Xmax != null ? d.Xmax * 1000 : undefined,
    Pe: d.Pe,
  };
}

// ---------------------------------------------------------------------------
// Driver library
// ---------------------------------------------------------------------------

interface IndexEntry {
  file: string; name: string; brand: string; model: string;
  Fs: number; Qts: number; Qes: number; Vas: number; Sd: number; Re: number;
  Xmax: number | null; Pe: number | null;
}

function libraryIndex(): IndexEntry[] {
  return JSON.parse(readFileSync(join(DRIVERS_DIR, 'index.json'), 'utf8'));
}

export function searchDrivers(query: string, limit = 10) {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = libraryIndex()
    .map(e => {
      const hay = `${e.name} ${e.brand} ${e.model}`.toLowerCase();
      if (!q.every(tok => hay.includes(tok))) return null;
      return { e, score: hay.indexOf(q[0]!) };
    })
    .filter((x): x is { e: IndexEntry; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name))
    .slice(0, limit);
  return scored.map(({ e }) => ({
    file: e.file, name: e.name,
    Fs: e.Fs, Qts: e.Qts, Vas_l: +(e.Vas * 1000).toPrecision(4),
    Sd_cm2: +(e.Sd * 1e4).toPrecision(4),
    Xmax_mm: e.Xmax != null ? +(e.Xmax * 1000).toPrecision(3) : null,
  }));
}

/** Load a library driver by its index `file`. Returns the engine Driver plus
 *  upstream's own Result<T> issues (errors block, warns only inform). */
export function loadDriver(file: string): { driver: Driver | null; ts: FriendlyTS | null; issues: DriverError[] } {
  const entry = libraryIndex().find(e => e.file === file);
  if (!entry) return { driver: null, ts: null, issues: [{ level: 'error', field: 'driverName', message: `Driver not in library: ${file} — call search_drivers first` }] };
  const wdr = WdrDriver.fromWdr(readFileSync(join(DRIVERS_DIR, entry.file), 'utf8'));
  const driver = wdr.toDriver();
  return { driver, ts: driver ? toFriendly(wdr.raw()) : null, issues: wdr.errors() };
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

export interface DesignInput {
  box: 'sealed' | 'vented';
  Qtc?: number;               // sealed target (default 0.707 — Butterworth)
  Vb_l?: number;              // vented: override QB3 volume
  Fb?: number;                // vented: override QB3 tuning
  portDia_mm?: number;        // vented: default = 25% of cone diameter
}

export interface DesignResult {
  issues: DriverError[];
  ebp: number;
  enclosureAdvice: string;
  design: {
    box: 'sealed' | 'vented';
    Vb_l: number;
    Qtc?: number; Fc?: number;          // sealed
    Fb?: number;                        // vented
    port?: { dia_mm: number; len_mm: number };
    alignment: string;
  };
  /** Ready to pass verbatim as `params` to the simulate tool. */
  simulateParams: Record<string, number | string>;
}

export function designBox(drv: Driver, input: DesignInput): DesignResult | { issues: DriverError[] } {
  const issues: DriverError[] = [];
  const driverEbp = ebp(drv);
  const enclosureAdvice =
    driverEbp < 50 ? `EBP=${driverEbp.toFixed(0)} < 50 — this driver suits sealed enclosures`
    : driverEbp > 100 ? `EBP=${driverEbp.toFixed(0)} > 100 — this driver suits vented enclosures`
    : `EBP=${driverEbp.toFixed(0)} — borderline; sealed and vented are both reasonable`;
  if ((input.box === 'sealed' && driverEbp > 100) || (input.box === 'vented' && driverEbp < 50))
    issues.push({ level: 'warn', field: 'box', message: enclosureAdvice });

  if (input.box === 'sealed') {
    const Qtc = input.Qtc ?? 0.707;
    const Vb = sealedFromQtc(drv, Qtc);
    if (Vb == null)
      return { issues: [{ level: 'error', field: 'Qtc', message: `Qtc=${Qtc} unreachable: driver Qts=${drv.Qts} — target Qtc must be greater than Qts` }] };
    const Fc = drv.Fs * Math.sqrt(1 + drv.Vas / Vb);
    return {
      issues, ebp: driverEbp, enclosureAdvice,
      design: { box: 'sealed', Vb_l: Vb * 1000, Qtc, Fc, alignment: `sealed Qtc=${Qtc}` },
      simulateParams: { box: 'sealed', Vb_l: Vb * 1000, Ql: 10, eg: 2.83 },
    };
  }

  // vented — QB3 (Thiele) by default; Vb/Fb overridable
  const qb3 = ventedAlignment(drv);
  const Vb = input.Vb_l != null ? input.Vb_l / 1000 : qb3.Vb;
  const Fb = input.Fb ?? qb3.Fb;
  // ponytail: naive port default — 25% of cone diameter, min 40 mm; refine if velocity warns
  const portDia_m = input.portDia_mm != null
    ? input.portDia_mm / 1000
    : Math.max(0.25 * 2 * Math.sqrt(drv.Sd / Math.PI), 0.04);
  const Sp = Math.PI * (portDia_m / 2) ** 2;
  const len_m = ventLength(Vb, Fb, Sp);
  return {
    issues, ebp: driverEbp, enclosureAdvice,
    design: {
      box: 'vented', Vb_l: Vb * 1000, Fb,
      port: { dia_mm: portDia_m * 1000, len_mm: len_m * 1000 },
      alignment: input.Vb_l != null || input.Fb != null ? 'custom' : 'QB3 (Thiele)',
    },
    simulateParams: { box: 'vented', Vb_l: Vb * 1000, Fb, portDia_mm: portDia_m * 1000, Ql: 10, eg: 2.83 },
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface SimulateInput {
  box: BoxType;
  Vb_l: number;
  Ql?: number;                // WinISD default: Ql=10
  eg?: number;                // drive voltage, V (default 2.83 — IEC 60268-5)
  nDrivers?: number;
  wiring?: 'series' | 'parallel';
  Fb?: number;                // vented tuning, Hz
  portDia_mm?: number;        // vented
  portLen_mm?: number;        // vented physical length; Fb then derived
  fmin?: number;
  fmax?: number;
}

const CURVE_POINTS = 60;

export interface SimulateResult {
  issues: DriverError[];
  stats: {
    F3: number | null;
    passbandSPL: number;
    Qtc?: number; Fc?: number;
    Fb?: number;
    port?: { dia_mm: number; len_mm: number };
    maxSPL: number; maxSPLlimitedBy: 'Xmax' | 'power';
    peakExcursion_mm: number; peakExcursionAt_Hz: number;
    peakImpedance_ohm: number; peakImpedanceAt_Hz: number;
  };
  /** SPL curve decimated to ~60 log-spaced points. */
  curve: { f: number; spl: number }[];
}

export function simulate(drv: Driver, input: SimulateInput): SimulateResult | { issues: DriverError[] } {
  const issues: DriverError[] = [];
  const Vb = input.Vb_l / 1000;

  const P: SweepParams = {
    Vb,
    Ql: input.Ql ?? 10,
    eg: input.eg ?? 2.83,
    nDrivers: input.nDrivers ?? 1,
    wiring: input.wiring ?? 'parallel',
    fmin: input.fmin ?? 10,
    fmax: input.fmax ?? 1000,
    N: 400,
  };

  let Fb: number | undefined;
  let port: { dia_mm: number; len_mm: number } | undefined;
  if (input.box === 'vented') {
    const dia_m = (input.portDia_mm ?? 100) / 1000;
    const Sp = Math.PI * (dia_m / 2) ** 2;
    if (input.portLen_mm != null) {
      const len_m = input.portLen_mm / 1000;
      P.Sp = Sp;
      P.Leff = len_m + END_CORRECTION * dia_m;
      Fb = tuningFromLength(Vb, len_m, Sp);
      port = { dia_mm: dia_m * 1000, len_mm: len_m * 1000 };
    } else {
      if (!(input.Fb! > 0))
        return { issues: [{ level: 'error', field: 'Fb', message: 'Vented box needs Fb (tuning Hz) or an explicit portLen_mm' }] };
      const len_m = ventLength(Vb, input.Fb!, Sp);
      P.Sp = Sp;
      P.Leff = len_m + END_CORRECTION * dia_m;
      Fb = input.Fb;
      port = { dia_mm: dia_m * 1000, len_mm: len_m * 1000 };
    }
  }

  // Le is "optional" upstream but the solver NaNs the whole impedance curve
  // without it — guard at the boundary (solve/sweep lack deriveDriver's guards).
  const d = drv.Le != null ? drv : { ...drv, Le: 0 };
  const sw = sweep(d, input.box, P);
  // Postcondition gate — a degenerate design must never ship a NaN curve (AD-5 spirit)
  const finite = classifyFinite(sw);
  if (finite?.level === 'error') return { issues: [...issues, finite] };
  if (finite) issues.push(finite);

  const mc: MaxCurvesResult = maxCurves(d, input.box, P);

  // port air velocity sanity — >17 m/s (~5% of c) means audible compression/chuffing
  if (input.box === 'vented') {
    const pvMax = Math.max(...sw.pv);
    if (pvMax > 17)
      issues.push({ level: 'warn', field: 'port', message: `Port air velocity peaks at ${pvMax.toFixed(1)} m/s — use a larger port diameter to avoid chuffing` });
  }

  // stats
  const iPk = sw.spl.indexOf(Math.max(...sw.spl));
  const ref = sw.spl[iPk]!;
  let F3: number | null = null;
  for (let i = iPk; i > 0; i--) {
    if (sw.spl[i - 1]! <= ref - 3 && sw.spl[i]! > ref - 3) {
      const t = (ref - 3 - sw.spl[i - 1]!) / (sw.spl[i]! - sw.spl[i - 1]!);
      F3 = Math.exp(Math.log(sw.fs[i - 1]!) + t * (Math.log(sw.fs[i]!) - Math.log(sw.fs[i - 1]!)));
      break;
    }
  }
  const iMaxSpl = mc.maxspl.indexOf(Math.max(...mc.maxspl));
  const iExc = sw.exc.indexOf(Math.max(...sw.exc));
  const iZ = sw.zmag.indexOf(Math.max(...sw.zmag));

  const stats: SimulateResult['stats'] = {
    F3: F3 != null ? +F3.toFixed(1) : null,
    passbandSPL: +ref.toFixed(1),
    maxSPL: +mc.maxspl[iMaxSpl]!.toFixed(1),
    maxSPLlimitedBy: mc.xlim[iMaxSpl] ? 'Xmax' : 'power',
    peakExcursion_mm: +sw.exc[iExc]!.toFixed(2),
    peakExcursionAt_Hz: +sw.fs[iExc]!.toFixed(1),
    peakImpedance_ohm: +sw.zmag[iZ]!.toFixed(1),
    peakImpedanceAt_Hz: +sw.fs[iZ]!.toFixed(1),
  };
  if (input.box === 'sealed') {
    const alpha = drv.Vas / Vb;
    stats.Qtc = +(drv.Qts * Math.sqrt(1 + alpha)).toFixed(3);
    stats.Fc = +(drv.Fs * Math.sqrt(1 + alpha)).toFixed(1);
  }
  if (Fb != null) { stats.Fb = +Fb.toFixed(1); stats.port = port; }

  const step = Math.max(1, Math.floor(sw.fs.length / CURVE_POINTS));
  const curve = sw.fs
    .map((f, i) => ({ f: +f.toFixed(1), spl: +sw.spl[i]!.toFixed(2) }))
    .filter((_, i) => i % step === 0);

  return { issues, stats, curve };
}

// ---------------------------------------------------------------------------
// Shared driver resolution for tools: either a library name or inline T/S.
// ---------------------------------------------------------------------------

export function resolveDriver(args: { driverName?: string; ts?: FriendlyTS }):
  { driver: Driver; ts: FriendlyTS; issues: DriverError[] } | { issues: DriverError[] } {
  if (args.driverName) {
    const { driver, ts, issues } = loadDriver(args.driverName);
    if (!driver) return { issues };
    return { driver, ts: ts!, issues };
  }
  if (args.ts) {
    const { value, errors } = deriveDriver(toRaw(args.ts));
    if (!value) return { issues: errors };
    return { driver: value, ts: args.ts, issues: errors };   // warns ride along
  }
  return { issues: [{ level: 'error', field: 'driver', message: 'Provide either driverName (from search_drivers) or ts (inline T/S parameters)' }] };
}

// ---------------------------------------------------------------------------
// Add a custom driver to the library (writes .wdr, rebuilds index)
// ---------------------------------------------------------------------------

export interface AddDriverInput extends FriendlyTS {
  brand?: string;
  model?: string;
  comment?: string;
}

export function addDriver(input: AddDriverInput): { file: string; issues: DriverError[] } | { issues: DriverError[] } {
  const { value: drv, errors } = deriveDriver(toRaw(input));
  if (!drv) return { issues: errors };
  // Build a minimal .wdr via upstream exporter (includes derived params + ParState)
  const wdrText = toWdr(toRaw(input));
  const safeName = (input.name || input.model || 'Custom').replace(/[^a-z0-9]+/gi, '_');
  const file = `custom__${safeName}.wdr`;
  writeFileSync(join(DRIVERS_DIR, file), wdrText);
  // Append to index.json so it appears in search immediately
  const idx = libraryIndex();
  const newEntry: IndexEntry = {
    file, name: input.name || input.model || 'Custom',
    brand: input.brand || '', model: input.model || '',
    Fs: drv.Fs, Qts: drv.Qts, Qes: drv.Qes, Vas: drv.Vas, Sd: drv.Sd, Re: drv.Re,
    Xmax: drv.Xmax ?? null, Pe: drv.Pe ?? null,
  };
  writeFileSync(join(DRIVERS_DIR, 'index.json'), JSON.stringify([...idx, newEntry]));
  // Re-verify it loads cleanly
  const { driver: verify, issues: verifyIssues } = loadDriver(file);
  if (!verify) return { issues: verifyIssues };
  return { file, issues: verifyIssues };
}
