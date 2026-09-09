export interface FieldManifest {
  schemaVersion: number;
  id: string;
  status: string;
  velocityAvailable: boolean;
  label?: string;
  model: { h: number; cInfinity: number; viscosity: number; scope: string; lambda?: number };
  domain: { radialMin: number; radialMax: number; axialMin: number; axialMax: number };
  time: { start: number; end: number; singular: number; playbackAvailable: boolean };
  core?: { yCount: number; etaCount: number; yMax: number; etaMax: number; channels: string[] };
  chunks: { url: string; kind: string; sha256: string; bytes: number }[];
}
export interface HeatTable {
  schemaVersion: number;
  zMin: number;
  zMax: number;
  count: number;
  h: number;
  cInfinity: number;
  values: number[];
}
export interface FieldData { manifest: FieldManifest; table: HeatTable | null; core: Float32Array | null }

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Validate the exact model supported by the current CPU and GPU samplers. */
export function validateManifest(value: unknown): FieldManifest {
  if (!record(value) || value.schemaVersion !== 1 || !['heat-exterior-checkpoint', 'local-core-checkpoint'].includes(String(value.status)) ||
      value.velocityAvailable !== true || typeof value.id !== 'string') {
    throw new Error('A supported, validated velocity field is not available.');
  }
  const isCore = value.status === 'local-core-checkpoint';
  const { model, domain, time, chunks } = value;
  if (!isCore && value.core !== undefined) throw new Error('Unexpected core metadata on exterior dataset.');
  if (isCore) {
    const c = value.core;
    if (!record(c) || !finite(c.yCount) || !Number.isSafeInteger(c.yCount) || c.yCount < 2 || c.yCount > 4096 ||
        !finite(c.etaCount) || !Number.isSafeInteger(c.etaCount) || c.etaCount < 2 || c.etaCount > 4096 ||
        !finite(c.yMax) || c.yMax <= 0 || !finite(c.etaMax) || c.etaMax <= 0 || c.etaMax > .9 ||
        JSON.stringify(c.channels) !== JSON.stringify(['F', 'U', 'v0', 'Pi']) ||
        !record(model) || !finite(model.lambda) || model.lambda < 1) throw new Error('Invalid local core coordinates.');
  }
  if (!record(model) || !finite(model.h) || !(model.h > 0 && model.h < .01) ||
      !finite(model.cInfinity) || model.cInfinity <= 0 || model.viscosity !== 1 || typeof model.scope !== 'string') {
    throw new Error('Unsupported heat-exterior model parameters.');
  }
  if (!record(domain) || !finite(domain.radialMin) || !finite(domain.radialMax) ||
      !finite(domain.axialMin) || !finite(domain.axialMax) ||
      !((isCore ? domain.radialMin === 0 : domain.radialMin > 0) && domain.radialMax > domain.radialMin && domain.axialMax > domain.axialMin)) {
    throw new Error('Dataset has an invalid spatial domain.');
  }
  if (!record(time) || !finite(time.start) || !finite(time.end) || time.singular !== 1 ||
      !(time.start >= 0 && time.start < time.end && time.end < time.singular) || time.playbackAvailable !== true) {
    throw new Error('Dataset has an unsupported time interval.');
  }
  if (!Array.isArray(chunks) || !chunks.length || !chunks.every(chunk => record(chunk) &&
      typeof chunk.url === 'string' && typeof chunk.kind === 'string' &&
      typeof chunk.sha256 === 'string' && /^[a-f0-9]{64}$/.test(chunk.sha256) &&
      finite(chunk.bytes) && Number.isSafeInteger(chunk.bytes) && chunk.bytes > 0) ||
      chunks.filter(chunk => chunk.kind === (isCore ? 'core-profile' : 'heat-profile')).length !== 1 ||
      chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) > 100_000_000) {
    throw new Error('Dataset has an invalid chunk inventory or exceeds 100 MB.');
  }
  return value as unknown as FieldManifest;
}

export function validateHeatTable(value: unknown, manifest: FieldManifest): HeatTable {
  if (!record(value) || value.schemaVersion !== 1 || value.kind !== 'heat-profile' ||
      !finite(value.count) || !Number.isSafeInteger(value.count) || value.count < 2 ||
      !Array.isArray(value.values) || value.count !== value.values.length ||
      value.zMin !== 0 || !finite(value.zMax) || value.zMax <= 0 ||
      value.h !== manifest.model.h || value.cInfinity !== manifest.model.cInfinity ||
      !value.values.every(v => finite(v) && v > 0 && v <= 1.000001)) {
    throw new Error('Dataset contains invalid or mismatched heat-profile samples.');
  }
  const values = value.values as number[];
  if (Math.abs(values[0] - 1) > 1e-6 || values.some((v, i) => i > 0 && v > values[i - 1] + 1e-12)) {
    throw new Error('Heat-profile normalization or monotonicity is invalid.');
  }
  const requiredMax = 4 * (manifest.time.singular - manifest.time.start) / manifest.domain.radialMin ** 2;
  if (requiredMax > value.zMax) throw new Error('Heat-profile lookup does not cover the declared space and time domain.');
  return value as unknown as HeatTable;
}

export async function loadField(kind: 'core' | 'exterior' = 'core'): Promise<FieldData> {
  const base = new URL(`${import.meta.env.BASE_URL}datasets/`, window.location.href);
  const response = await fetch(new URL(kind === 'core' ? 'core-manifest.json' : 'manifest.json', base));
  if (!response.ok) throw new Error(`Dataset manifest could not load (${response.status}).`);
  const manifest = validateManifest(await response.json());
  const chunk = manifest.chunks.find(c => c.kind === (manifest.core ? 'core-profile' : 'heat-profile'));
  if (!chunk) throw new Error('Dataset is missing its heat-profile chunk.');
  const url = new URL(chunk.url, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Dataset chunk is outside its directory.');
  const dataResponse = await fetch(url);
  if (!dataResponse.ok) throw new Error(`Field table could not load (${dataResponse.status}).`);
  const bytes = await dataResponse.arrayBuffer();
  if (bytes.byteLength !== chunk.bytes) throw new Error('Dataset byte count does not match its manifest.');
  {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (hash !== chunk.sha256) throw new Error('Dataset checksum does not match its manifest.');
  }
  if (manifest.core) {
    const c = manifest.core;
    if (bytes.byteLength !== c.yCount * c.etaCount * 16) throw new Error('Invalid core table size.');
    const view = new DataView(bytes);
    const core = new Float32Array(bytes.byteLength / 4);
    for (let i = 0; i < core.length; i++) {
      core[i] = view.getFloat32(i * 4, true);
      if (!Number.isFinite(core[i]) || (i % 4 === 0 && core[i] <= 0)) throw new Error('Invalid core profile sample.');
    }
    return { manifest, table: null, core };
  }
  const table = validateHeatTable(JSON.parse(new TextDecoder().decode(bytes)), manifest);
  return { manifest, table, core: null };
}

export function sampleVelocity(field: FieldData, p: readonly number[], time: number): [number, number, number] | null {
  const { domain, model, time: interval } = field.manifest;
  if (p.length !== 3 || !p.every(Number.isFinite) || !Number.isFinite(time)) return null;
  if (field.core) return sampleCore(field, p, time);
  const rawRadius = Math.hypot(p[0], p[1]);
  if (!Number.isFinite(rawRadius)) return null;
  // Cartesian conversion plus hypot can move an exact boundary point by an
  // ulp. Accept only a few float64 rounding units, then evaluate the scalar
  // profile at the declared boundary. This is not an extrapolation margin.
  const radialRounding = (bound: number) => 4 * Number.EPSILON * Math.max(rawRadius, bound);
  if (rawRadius < domain.radialMin - radialRounding(domain.radialMin) ||
      rawRadius > domain.radialMax + radialRounding(domain.radialMax) ||
      p[2] < domain.axialMin || p[2] > domain.axialMax || time < interval.start || time > interval.end) return null;
  const r = Math.max(domain.radialMin, Math.min(domain.radialMax, rawRadius));
  const z = 4 * (interval.singular - time) / (r * r);
  const table = field.table!;
  if (z < table.zMin || z > table.zMax) return null;
  const f = (z - table.zMin) / (table.zMax - table.zMin) * (table.count - 1);
  const i = Math.min(table.count - 2, Math.floor(f));
  const H = table.values[i] + (f - i) * (table.values[i + 1] - table.values[i]);
  const speed = model.cInfinity * (r * r / 2) ** (-0.5 - model.h) * H;
  return [-speed * p[1] / rawRadius, speed * p[0] / rawRadius, 0];
}

/** Reconstruct the contracting physical patch, including its regular axis. */
function sampleCore(field: FieldData, p: readonly number[], time: number): [number, number, number] | null {
  const { model, core: c, time: interval } = field.manifest;
  if (!c || !field.core || time < interval.start || time > interval.end) return null;
  const tau = interval.singular - time, D = .5 - model.h;
  // Bound eta before iteration. On this patch the fixed-point contraction
  // derivative is bounded by 2h*etaMax²/(1-etaMax²)^(1-2h),
  // below .086 on the supported patch; it rapidly drops near the fixed point.
  const qMax = tau / (1 - c.etaMax ** 2);
  if (Math.abs(p[2]) > c.etaMax * qMax ** D) return null;
  let q = tau;
  for (let i = 0; i < 10; i++) q = tau + p[2] ** 2 * q ** (2 * model.h);
  const eta = p[2] / q ** D;
  const y = model.lambda! * (p[0] ** 2 + p[1] ** 2) / (2 * q);
  if (Math.abs(eta) > c.etaMax + 8 * Number.EPSILON || y > c.yMax + 8 * Number.EPSILON) return null;
  const a = Math.min(c.yCount - 1, y / c.yMax * (c.yCount - 1));
  const b = Math.max(0, Math.min(c.etaCount - 1, (eta / c.etaMax + 1) * .5 * (c.etaCount - 1)));
  const ix = Math.min(c.yCount - 2, Math.floor(a)), iz = Math.min(c.etaCount - 2, Math.floor(b));
  const at = (x: number, z: number, channel: number) => field.core![(z * c.yCount + x) * 4 + channel];
  const channel = (k: number) => {
    const lo = at(ix, iz, k) * (1 - a + ix) + at(ix + 1, iz, k) * (a - ix);
    const hi = at(ix, iz + 1, k) * (1 - a + ix) + at(ix + 1, iz + 1, k) * (a - ix);
    return lo * (1 - b + iz) + hi * (b - iz);
  };
  const radial = channel(2) / (2 * q), rotation = q ** (-1 - model.h) * channel(0);
  return [radial * p[0] - rotation * p[1], radial * p[1] + rotation * p[0], q ** (-.5 - model.h) * channel(1)];
}
