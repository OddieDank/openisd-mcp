/**
 * MCP tool definitions — validation at the boundary (zod), then straight into
 * design.ts. Every tool is stateless: the design lives in the agent's
 * conversation, never in server memory. Engine Result<T> issues are propagated
 * as-is so the agent can tell a blocking error from a dismissable warn.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchDrivers, loadDriver, designBox, simulate, resolveDriver } from './design.js';
import type { FriendlyTS, DesignInput, SimulateInput } from './design.js';

const tsSchema = z.object({
  name: z.string().optional(),
  Fs: z.number().positive().describe('Resonant frequency, Hz'),
  Qts: z.number().positive().optional(),
  Qes: z.number().positive().optional(),
  Qms: z.number().positive().optional(),
  Vas_l: z.number().positive().describe('Equivalent compliance volume, litres'),
  Sd_cm2: z.number().positive().describe('Piston area, cm²'),
  Re: z.number().positive().describe('DC resistance, ohm'),
  Le_mH: z.number().positive().optional(),
  Xmax_mm: z.number().positive().optional(),
  Pe: z.number().positive().optional().describe('Rated power, W'),
}).refine(v => [v.Qts, v.Qes, v.Qms].filter(x => x != null).length >= 2,
  { message: 'At least two of Qts/Qes/Qms are required — the third is derived' });

const driverRef = {
  driverName: z.string().optional().describe('Library driver file, from search_drivers (e.g. "winisd__Dayton RSS315HFA-8.wdr")'),
  ts: tsSchema.optional().describe('Inline T/S parameters if not using the library'),
};

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, ...(payload as object) }, null, 2) }] };
}
function fail(issues: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, issues }, null, 2) }], isError: true };
}

export function registerTools(server: McpServer): void {

  server.registerTool('search_drivers', {
    description: 'Search the OpenISD driver library (1600+ woofers/subs, from WinISD .wdr files) by brand/model keywords. Returns matching drivers with key T/S params and the `file` to use as driverName elsewhere.',
    inputSchema: {
      query: z.string().describe('Keywords, e.g. "dayton rss315" or "b&c 12"'),
      limit: z.number().int().min(1).max(50).optional(),
    },
  }, async ({ query, limit }) => {
    const results = searchDrivers(query, limit);
    return results.length ? ok({ results }) : fail([{ level: 'error', field: 'query', message: `No drivers match "${query}"` }]);
  });

  server.registerTool('get_driver', {
    description: 'Load a library driver: full T/S parameters (friendly units) plus upstream validation issues. Warns (e.g. Xmax undefined) do not block — they only omit reference lines.',
    inputSchema: { driverName: z.string().describe('Driver file from search_drivers') },
  }, async ({ driverName }) => {
    const { driver, ts, issues } = loadDriver(driverName);
    if (!driver) return fail(issues);
    return ok({ driverName, ts, derived: { Cms: driver.Cms, Mms_kg: driver.Mms, Bl: driver.Bl }, issues });
  });

  server.registerTool('design_box', {
    description: 'Compute an enclosure for a driver: sealed from a target Qtc (default 0.707 Butterworth) or vented from the QB3/Thiele alignment (Vb, Fb, port dimensions). Includes EBP suitability advice. Returns simulateParams ready to pass to simulate.',
    inputSchema: {
      ...driverRef,
      box: z.enum(['sealed', 'vented']),
      Qtc: z.number().positive().optional().describe('Sealed target Qtc (default 0.707)'),
      Vb_l: z.number().positive().optional().describe('Vented: override QB3 box volume, litres'),
      Fb: z.number().positive().optional().describe('Vented: override QB3 tuning, Hz'),
      portDia_mm: z.number().positive().optional().describe('Vented: port diameter, mm (default 25% of cone diameter)'),
    },
  }, async (args) => {
    const r = resolveDriver(args as { driverName?: string; ts?: FriendlyTS });
    if (!('driver' in r)) return fail(r.issues);
    const out = designBox(r.driver, args as DesignInput);
    if (!('design' in out)) return fail(out.issues);
    return ok({ driver: r.ts, ...out });
  });

  server.registerTool('simulate', {
    description: 'Run the OpenISD Thiele-Small engine on a design: SPL curve (~60 points), F3, Qtc/Fc or Fb, max SPL and its limiter (Xmax vs power), excursion and impedance peaks. Degenerate designs (NaN curves) are rejected before returning.',
    inputSchema: {
      ...driverRef,
      box: z.enum(['sealed', 'vented']),
      Vb_l: z.number().positive().describe('Box volume, litres'),
      Ql: z.number().positive().optional().describe('Leakage loss (WinISD default Ql=10)'),
      eg: z.number().positive().optional().describe('Drive voltage, V (default 2.83 — IEC 60268-5)'),
      nDrivers: z.number().int().positive().optional(),
      wiring: z.enum(['series', 'parallel']).optional(),
      Fb: z.number().positive().optional().describe('Vented: tuning, Hz'),
      portDia_mm: z.number().positive().optional(),
      portLen_mm: z.number().positive().optional().describe('Vented: explicit physical port length, mm (Fb then derived)'),
      fmin: z.number().positive().optional(),
      fmax: z.number().positive().optional(),
    },
  }, async (args) => {
    const r = resolveDriver(args as { driverName?: string; ts?: FriendlyTS });
    if (!('driver' in r)) return fail(r.issues);
    const out = simulate(r.driver, args as SimulateInput);
    if (!('stats' in out)) return fail(out.issues);
    return ok({ driver: r.ts, ...out });
  });
}
