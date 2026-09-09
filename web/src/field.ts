export interface FieldManifest {
  schemaVersion: number;
  id: string;
  status: string;
  velocityAvailable: boolean;
  label?: string;
  model: { h: number; cInfinity: number; viscosity: number; scope: string };
  domain: { radialMin: number; radialMax: number; axialMin: number; axialMax: number };
  time: { start: number; end: number; singular: number; playbackAvailable: boolean };
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
export interface FieldData { manifest: FieldManifest; table: HeatTable }

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Validate the exact model supported by the current CPU and GPU samplers. */
export function validateManifest(value: unknown): FieldManifest {
  if (!record(value) || value.schemaVersion !== 1 || value.status !== 'heat-exterior-checkpoint' ||
      value.velocityAvailable !== true || typeof value.id !== 'string') {
    throw new Error('A supported, validated velocity field is not available.');
  }
  const { model, domain, time, chunks } = value;
  if (!record(model) || !finite(model.h) || !(model.h > 0 && model.h < .01) ||
      !finite(model.cInfinity) || model.cInfinity <= 0 || model.viscosity !== 1 || typeof model.scope !== 'string') {
    throw new Error('Unsupported heat-exterior model parameters.');
  }
  if (!record(domain) || !finite(domain.radialMin) || !finite(domain.radialMax) ||
      !finite(domain.axialMin) || !finite(domain.axialMax) ||
      !(domain.radialMin > 0 && domain.radialMax > domain.radialMin && domain.axialMax > domain.axialMin)) {
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
      chunks.filter(chunk => chunk.kind === 'heat-profile').length !== 1 ||
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

export async function loadField(): Promise<FieldData> {
  const base = new URL(`${import.meta.env.BASE_URL}datasets/`, window.location.href);
  const response = await fetch(new URL('manifest.json', base));
  if (!response.ok) throw new Error(`Dataset manifest could not load (${response.status}).`);
  const manifest = validateManifest(await response.json());
  const chunk = manifest.chunks.find(c => c.kind === 'heat-profile');
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
  const table = validateHeatTable(JSON.parse(new TextDecoder().decode(bytes)), manifest);
  return { manifest, table };
}

export function sampleVelocity(field: FieldData, p: readonly number[], time: number): [number, number, number] | null {
  const { domain, model, time: interval } = field.manifest;
  if (p.length !== 3 || !p.every(Number.isFinite) || !Number.isFinite(time)) return null;
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
  const table = field.table;
  if (z < table.zMin || z > table.zMax) return null;
  const f = (z - table.zMin) / (table.zMax - table.zMin) * (table.count - 1);
  const i = Math.min(table.count - 2, Math.floor(f));
  const H = table.values[i] + (f - i) * (table.values[i + 1] - table.values[i]);
  const speed = model.cInfinity * (r * r / 2) ** (-0.5 - model.h) * H;
  return [-speed * p[1] / rawRadius, speed * p[0] / rawRadius, 0];
}
