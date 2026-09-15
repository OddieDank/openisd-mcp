/**
 * Design evaluation — automated PASS/WARN/FAIL checklist based on
 * established loudspeaker enclosure engineering criteria.
 * All thresholds from standard T/S design practice (Small, Thiele, Leach, WinISD docs).
 */

import type { Driver, DriverError } from '../vendor/dist/engine/index.js';
import type { SimulateResult } from './design.js';

interface Check {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
  value?: number | string;
  threshold?: string;
}

interface Evaluation {
  overall: 'PASS' | 'WARN' | 'FAIL';
  checks: Check[];
  summary: string;
}

const C = 343.21; // m/s

function evalSealed(drv: Driver, sim: SimulateResult, Vb_l: number): Check[] {
  const checks: Check[] = [];
  const alpha = drv.Vas! / (Vb_l / 1000);
  const Qtc = drv.Qts! * Math.sqrt(1 + alpha);
  const Fc = drv.Fs! * Math.sqrt(1 + alpha);
  const F3 = sim.stats.F3 ?? null;

  // Qtc range — sealed
  if (Qtc >= 0.5 && Qtc <= 0.707) {
    checks.push({ name: 'Qtc', status: 'PASS', message: `Qtc=${Qtc.toFixed(3)} — Butterworth to slightly overdamped (ideal)`, value: Qtc, threshold: '0.5–0.707' });
  } else if (Qtc > 0.707 && Qtc <= 1.0) {
    checks.push({ name: 'Qtc', status: 'WARN', message: `Qtc=${Qtc.toFixed(3)} — underdamped, slight peak near Fc`, value: Qtc, threshold: '0.5–0.707 ideal, ≤1.0 acceptable' });
  } else {
    checks.push({ name: 'Qtc', status: 'FAIL', message: `Qtc=${Qtc.toFixed(3)} — ${Qtc > 1 ? 'excessively peaky/boomy' : 'overdamped, weak bass'}`, value: Qtc, threshold: '0.5–1.0' });
  }

  // F3 vs Fc — sealed 2nd order: F3 ≈ Fc * 0.5^(1/2) for Qtc=0.707, but varies
  if (F3 && Fc) {
    const ratio = F3 / Fc;
    if (ratio >= 0.45 && ratio <= 0.7) {
      checks.push({ name: 'F3/Fc', status: 'PASS', message: `F3/Fc=${ratio.toFixed(2)} — expected for Qtc≈${Qtc.toFixed(2)}`, value: ratio, threshold: '0.45–0.7' });
    } else {
      checks.push({ name: 'F3/Fc', status: 'WARN', message: `F3/Fc=${ratio.toFixed(2)} — unusual for this Qtc`, value: ratio, threshold: '0.45–0.7' });
    }
  }

  // Excursion margin — at F3 (worst case near Fc)
  if (drv.Xmax! > 0) {
    const excFc = sim.curve.find(p => Math.abs(p.f - Fc) < 1)?.spl;
    // Use peak excursion from stats
    const margin = (drv.Xmax! * 1000 - sim.stats.peakExcursion_mm) / (drv.Xmax! * 1000);
    if (margin >= 0.3) {
      checks.push({ name: 'Excursion margin', status: 'PASS', message: `Peak ${sim.stats.peakExcursion_mm.toFixed(1)}mm vs Xmax ${(drv.Xmax!*1000).toFixed(1)}mm (${(margin*100).toFixed(0)}% headroom)`, value: margin, threshold: '≥30%' });
    } else if (margin >= 0.1) {
      checks.push({ name: 'Excursion margin', status: 'WARN', message: `Peak ${sim.stats.peakExcursion_mm.toFixed(1)}mm vs Xmax ${(drv.Xmax!*1000).toFixed(1)}mm (${(margin*100).toFixed(0)}% headroom — high drive risky)`, value: margin, threshold: '≥30%' });
    } else {
      checks.push({ name: 'Excursion margin', status: 'FAIL', message: `Peak ${sim.stats.peakExcursion_mm.toFixed(1)}mm EXCEEDS Xmax ${(drv.Xmax!*1000).toFixed(1)}mm — driver will bottom out`, value: margin, threshold: '≥30%' });
    }
  }

  // Power vs excursion limit — from maxCurves
  if (sim.stats.maxSPLlimitedBy === 'Xmax') {
    checks.push({ name: 'SPL limiter', status: 'WARN', message: 'Max SPL limited by Xmax (not thermal) — high excursion at high SPL', value: 'Xmax', threshold: 'thermal preferred' });
  } else {
    checks.push({ name: 'SPL limiter', status: 'PASS', message: 'Max SPL limited by thermal power (Pe) — safe', value: 'thermal' });
  }

  // Box volume sanity
  const Vb_ratio = Vb_l / (drv.Vas! * 1000);
  if (Vb_ratio >= 0.2 && Vb_ratio <= 5) {
    checks.push({ name: 'Vb/Vas', status: 'PASS', message: `Vb/Vas=${Vb_ratio.toFixed(2)} — reasonable`, value: Vb_ratio, threshold: '0.2–5' });
  } else {
    checks.push({ name: 'Vb/Vas', status: 'WARN', message: `Vb/Vas=${Vb_ratio.toFixed(2)} — ${Vb_ratio < 0.2 ? 'very small box' : 'very large box'}`, value: Vb_ratio, threshold: '0.2–5' });
  }

  return checks;
}

function evalVented(drv: Driver, sim: SimulateResult, Vb_l: number, Fb: number, portDia_mm: number, portLen_mm: number): Check[] {
  const checks: Check[] = [];

  // Fb/Fs ratio — vented QB3 target ~0.8-1.0
  const fb_fs = Fb / drv.Fs!;
  if (fb_fs >= 0.8 && fb_fs <= 1.0) {
    checks.push({ name: 'Fb/Fs', status: 'PASS', message: `Fb/Fs=${fb_fs.toFixed(2)} — QB3 alignment range`, value: fb_fs, threshold: '0.8–1.0 (QB3)' });
  } else if (fb_fs >= 0.6 && fb_fs <= 1.2) {
    checks.push({ name: 'Fb/Fs', status: 'WARN', message: `Fb/Fs=${fb_fs.toFixed(2)} — outside QB3, check alignment`, value: fb_fs, threshold: '0.8–1.0 (QB3), 0.6–1.2 broad' });
  } else {
    checks.push({ name: 'Fb/Fs', status: 'FAIL', message: `Fb/Fs=${fb_fs.toFixed(2)} — extreme, likely wrong alignment`, value: fb_fs, threshold: '0.6–1.2' });
  }

  // Port velocity — chuffing threshold ~17 m/s (5% of c)
  const portArea = Math.PI * (portDia_mm / 2000) ** 2; // m²
  // Approximate peak port velocity from sim pv array — max in sim is already computed in design.ts
  // We don't have pv in stats, but design.ts logs warn if >17 m/s. Re-check:
  // For now use the heuristic: if port area small relative to Sd, velocity high
  const sd = drv.Sd!;
  const areaRatio = portArea / sd;
  if (areaRatio >= 0.25) {
    checks.push({ name: 'Port area / Sd', status: 'PASS', message: `Port area / Sd = ${(areaRatio*100).toFixed(0)}% — low velocity`, value: areaRatio, threshold: '≥25%' });
  } else if (areaRatio >= 0.15) {
    checks.push({ name: 'Port area / Sd', status: 'WARN', message: `Port area / Sd = ${(areaRatio*100).toFixed(0)}% — moderate velocity, watch for chuffing at high SPL`, value: areaRatio, threshold: '≥25%' });
  } else {
    checks.push({ name: 'Port area / Sd', status: 'FAIL', message: `Port area / Sd = ${(areaRatio*100).toFixed(0)}% — HIGH velocity, audible chuffing likely`, value: areaRatio, threshold: '≥25%' });
  }

  // Port length practicality — too long = pipe resonance, too short = unrealistic
  if (portLen_mm >= 50 && portLen_mm <= 600) {
    checks.push({ name: 'Port length', status: 'PASS', message: `Port length ${portLen_mm.toFixed(0)}mm — practical`, value: portLen_mm, threshold: '50–600mm' });
  } else if (portLen_mm > 600) {
    checks.push({ name: 'Port length', status: 'WARN', message: `Port length ${portLen_mm.toFixed(0)}mm — very long, consider larger diameter or passive radiator`, value: portLen_mm, threshold: '≤600mm' });
  } else {
    checks.push({ name: 'Port length', status: 'FAIL', message: `Port length ${portLen_mm.toFixed(0)}mm — too short (or negative), invalid`, value: portLen_mm, threshold: '≥50mm' });
  }

  // Port Mach number at max power — estimate
  if (drv.Xmax! > 0 && drv.Pe! > 0) {
    // Quick estimate: max volume velocity ~ 2π·Fb·Sd·Xmax (at resonance)
    const Umax = 2 * Math.PI * Fb * drv.Sd! * drv.Xmax!;
    const vmax = Umax / portArea;
    const mach = vmax / C;
    if (mach <= 0.05) {
      checks.push({ name: 'Port Mach @ Xmax', status: 'PASS', message: `Mach ${mach.toFixed(3)} (<5%) — no compression`, value: mach, threshold: '≤0.05' });
    } else if (mach <= 0.1) {
      checks.push({ name: 'Port Mach @ Xmax', status: 'WARN', message: `Mach ${mach.toFixed(3)} (5–10%) — slight compression at max output`, value: mach, threshold: '≤0.05' });
    } else {
      checks.push({ name: 'Port Mach @ Xmax', status: 'FAIL', message: `Mach ${mach.toFixed(3)} (>10%) — severe compression/chuffing at max output`, value: mach, threshold: '≤0.05' });
    }
  }

  // Excursion margin — vented worst case at Fb (unloaded below Fb)
  if (drv.Xmax! > 0) {
    // sim.stats.peakExcursionAt_Hz should be near Fb
    const margin = (drv.Xmax! * 1000 - sim.stats.peakExcursion_mm) / (drv.Xmax! * 1000);
    if (margin >= 0.3) {
      checks.push({ name: 'Excursion margin', status: 'PASS', message: `Peak ${sim.stats.peakExcursion_mm.toFixed(1)}mm vs Xmax ${(drv.Xmax!*1000).toFixed(1)}mm (${(margin*100).toFixed(0)}% headroom)`, value: margin, threshold: '≥30%' });
    } else if (margin >= 0.1) {
      checks.push({ name: 'Excursion margin', status: 'WARN', message: `Peak ${sim.stats.peakExcursion_mm.toFixed(1)}mm vs Xmax ${(drv.Xmax!*1000).toFixed(1)}mm (${(margin*100).toFixed(0)}% headroom — high drive risky)`, value: margin, threshold: '≥30%' });
    } else {
      checks.push({ name: 'Excursion margin', status: 'FAIL', message: `Peak ${sim.stats.peakExcursion_mm.toFixed(1)}mm EXCEEDS Xmax ${(drv.Xmax!*1000).toFixed(1)}mm — driver will bottom out below Fb`, value: margin, threshold: '≥30%' });
    }
  }

  // SPL limiter
  if (sim.stats.maxSPLlimitedBy === 'Xmax') {
    checks.push({ name: 'SPL limiter', status: 'WARN', message: 'Max SPL limited by Xmax — excursion runs out before thermal limit', value: 'Xmax', threshold: 'thermal preferred' });
  } else {
    checks.push({ name: 'SPL limiter', status: 'PASS', message: 'Max SPL limited by thermal power — safe', value: 'thermal' });
  }

  // Impedance peak — very high peaks can stress some amps
  if (sim.stats.peakImpedance_ohm <= 500) {
    checks.push({ name: 'Peak impedance', status: 'PASS', message: `Zpeak ${sim.stats.peakImpedance_ohm.toFixed(1)}Ω — amplifier friendly`, value: sim.stats.peakImpedance_ohm, threshold: '≤500Ω' });
  } else {
    checks.push({ name: 'Peak impedance', status: 'WARN', message: `Zpeak ${sim.stats.peakImpedance_ohm.toFixed(1)}Ω — very high, may stress marginal amps`, value: sim.stats.peakImpedance_ohm, threshold: '≤500Ω' });
  }

  // Box volume
  const Vb_ratio = Vb_l / (drv.Vas! * 1000);
  if (Vb_ratio >= 0.5 && Vb_ratio <= 10) {
    checks.push({ name: 'Vb/Vas', status: 'PASS', message: `Vb/Vas=${Vb_ratio.toFixed(2)} — reasonable`, value: Vb_ratio, threshold: '0.5–10' });
  } else {
    checks.push({ name: 'Vb/Vas', status: 'WARN', message: `Vb/Vas=${Vb_ratio.toFixed(2)} — ${Vb_ratio < 0.5 ? 'small for vented' : 'very large'}`, value: Vb_ratio, threshold: '0.5–10' });
  }

  return checks;
}

function evalCommon(drv: Driver, sim: SimulateResult, designBox: string): Check[] {
  const checks: Check[] = [];

  // F3 — should be below some target (application dependent)
  if (sim.stats.F3) {
    if (sim.stats.F3 <= 60) {
      checks.push({ name: 'F3', status: 'PASS', message: `F3 = ${sim.stats.F3.toFixed(1)}Hz — good subwoofer extension`, value: sim.stats.F3, threshold: '≤60Hz for sub' });
    } else if (sim.stats.F3 <= 100) {
      checks.push({ name: 'F3', status: 'WARN', message: `F3 = ${sim.stats.F3.toFixed(1)}Hz — limited low end, more mid-bass`, value: sim.stats.F3, threshold: '≤60Hz for sub, ≤100Hz for woofer' });
    } else {
      checks.push({ name: 'F3', status: 'FAIL', message: `F3 = ${sim.stats.F3.toFixed(1)}Hz — no useful bass extension`, value: sim.stats.F3, threshold: '≤100Hz' });
    }
  }

  // Sensitivity / passband SPL at 2.83V/1m
  const spl = sim.stats.passbandSPL;
  if (spl >= 90) {
    checks.push({ name: 'Sensitivity', status: 'PASS', message: `Passband SPL = ${spl.toFixed(1)}dB @ 2.83V/1m — high sensitivity`, value: spl, threshold: '≥90dB' });
  } else if (spl >= 85) {
    checks.push({ name: 'Sensitivity', status: 'PASS', message: `Passband SPL = ${spl.toFixed(1)}dB @ 2.83V/1m — average`, value: spl, threshold: '≥85dB' });
  } else {
    checks.push({ name: 'Sensitivity', status: 'WARN', message: `Passband SPL = ${spl.toFixed(1)}dB @ 2.83V/1m — low, needs more power`, value: spl, threshold: '≥85dB' });
  }

  // EBP suitability (from design)
  // We don't have ebp here, but design_box returns enclosureAdvice with it
  // Skip — design_box already flags EBP mismatch as warn

  // Driver validation warnings carried through
  // (deriveDriver warns: Xmax missing, Pe missing — already in issues)

  return checks;
}

export function evaluateDesign(
  drv: Driver,
  sim: SimulateResult,
  design: { box: 'sealed' | 'vented'; Vb_l: number; Qtc?: number; Fc?: number; Fb?: number; port?: { dia_mm: number; len_mm: number }; alignment: string }
): Evaluation {
  let checks: Check[] = [];

  if (design.box === 'sealed') {
    checks = evalSealed(drv, sim, design.Vb_l);
  } else {
    if (!design.Fb || !design.port) throw new Error('vented design missing Fb/port');
    checks = evalVented(drv, sim, design.Vb_l, design.Fb, design.port.dia_mm, design.port.len_mm);
  }

  checks.push(...evalCommon(drv, sim, design.box));

  // Overall: FAIL if any FAIL, else WARN if any WARN, else PASS
  const hasFail = checks.some(c => c.status === 'FAIL');
  const hasWarn = checks.some(c => c.status === 'WARN');
  const overall = hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS';

  const summaryLines = [
    `Overall: ${overall}`,
    `Box: ${design.box.toUpperCase()} (${design.alignment})  Vb=${design.Vb_l.toFixed(1)}L`,
    design.box === 'sealed'
      ? `  Qtc=${design.Qtc?.toFixed(3)}, Fc=${design.Fc?.toFixed(1)}Hz`
      : `  Fb=${design.Fb?.toFixed(1)}Hz, Port=${design.port?.dia_mm.toFixed(0)}mm×${design.port?.len_mm.toFixed(0)}mm`,
    `  F3=${sim.stats.F3?.toFixed(1) ?? '?'}Hz  Passband=${sim.stats.passbandSPL.toFixed(1)}dB  MaxSPL=${sim.stats.maxSPL.toFixed(1)}dB (${sim.stats.maxSPLlimitedBy})`,
    `  Excursion peak=${sim.stats.peakExcursion_mm.toFixed(1)}mm @ ${sim.stats.peakExcursionAt_Hz.toFixed(1)}Hz`,
    '',
    ...checks.map(c => `  [${c.status}] ${c.name}: ${c.message}`)
  ];

  return { overall, checks, summary: summaryLines.join('\n') };
}