import type { FieldData } from './field';

function basis(t: number) {
  return [2*t*t*t-3*t*t+1, t*t*t-2*t*t+t, -2*t*t*t+3*t*t, t*t*t-t*t];
}
function derivative(t: number) { return [6*t*t-6*t, 3*t*t-4*t+1, -6*t*t+6*t, 3*t*t-2*t]; }

/** A single primitive supplies both meridional velocity derivatives. */
export function extendedProfile(field: FieldData, y: number, eta: number) {
  const c = field.manifest.core!, data = field.core!, swirl = field.swirl!;
  const hy = c.yMax / (c.yCount - 1), he = 2 / (c.etaCount - 1);
  const a = Math.max(0, Math.min(c.yCount - 1, y / hy));
  const b = Math.max(0, Math.min(c.etaCount - 1, (eta + 1) / he));
  const iy = Math.min(c.yCount - 2, Math.floor(a)), ie = Math.min(c.etaCount - 2, Math.floor(b));
  const wy = basis(a - iy), dy = derivative(a - iy), we = basis(b - ie), de = derivative(b - ie);
  const rows = [0, 1].map(row => {
    const lo = ((ie + row) * c.yCount + iy) * 4, hi = lo + 4;
    const evalY = (v: number[], k: number) => v[0]*data[lo+k] + v[1]*hy*data[lo+k+1] + v[2]*data[hi+k] + v[3]*hy*data[hi+k+1];
    return [evalY(wy, 0), evalY(dy, 0)/hy, evalY(wy, 2), evalY(dy, 2)/hy];
  });
  const j = we[0]*rows[0][0]+we[1]*he*rows[0][2]+we[2]*rows[1][0]+we[3]*he*rows[1][2];
  const jy = we[0]*rows[0][1]+we[1]*he*rows[0][3]+we[2]*rows[1][1]+we[3]*he*rows[1][3];
  const je = (de[0]*rows[0][0]+de[1]*he*rows[0][2]+de[2]*rows[1][0]+de[3]*he*rows[1][2])/he;
  const f0 = swirl[ie*c.yCount+iy]*(1-a+iy)+swirl[ie*c.yCount+iy+1]*(a-iy);
  const f1 = swirl[(ie+1)*c.yCount+iy]*(1-a+iy)+swirl[(ie+1)*c.yCount+iy+1]*(a-iy);
  return { j, jy, je, f: f0*(1-b+ie)+f1*(b-ie) };
}

export function sampleExtended(field: FieldData, p: readonly number[], time: number): [number, number, number] | null {
  const m = field.manifest, h = m.model.h, lam = m.model.lambda!;
  if (time < m.time.start || time > m.time.end) return null;
  const radius = Math.hypot(...p), inner = m.model.cutoffInner!, outer = m.model.cutoffOuter!;
  if (radius >= outer) return [0, 0, 0]; // computed stationary fluid, not missing data
  let cutoff = 1, radialCutoff = 0;
  if (radius > inner) {
    const span = outer*outer-inner*inner, s = (radius*radius-inner*inner)/span;
    const left = Math.exp(-1/s), right = Math.exp(-1/(1-s)), step = left/(left+right);
    cutoff = 1-step;
    radialCutoff = -2*step*(1-step)*(1/(s*s)+1/((1-s)*(1-s)))/span;
  }
  const tau = m.time.singular-time, d = .5-h, r2 = p[0]*p[0]+p[1]*p[1];
  let q = Math.max(tau, Math.abs(p[2])**(1/d));
  for (let i = 0; i < 10; i++) q = tau+p[2]*p[2]*q**(2*h);
  const y = lam*r2/(2*q), eta = Math.max(-1, Math.min(1, p[2]/q**d));
  if (y >= m.core!.yMax) {
    const table = field.table!, z = 4*tau/r2;
    const index = Math.max(0, Math.min(table.count-1, z/table.zMax*(table.count-1)));
    const i = Math.min(table.count-2, Math.floor(index));
    const heat = table.values[i]*(1-index+i)+table.values[i+1]*(index-i);
    const rotation = cutoff*m.model.cInfinity*(r2/2)**(-.5-h)*heat/Math.sqrt(r2);
    return [-rotation*p[1], rotation*p[0], 0];
  }
  const v = extendedProfile(field, y, eta), L = 1-2*h*eta*eta;
  const jOverY = y > 0 ? v.j/y : v.jy;
  const jeOverY = y > 0 ? v.je/y : 0; // radial coefficient multiplies x=y=0 on axis
  const radial = -cutoff*lam*(2*d*eta*jOverY+(1-eta*eta)*jeOverY-2*eta*v.jy)/(2*q*L)
    - radialCutoff*p[2]*lam*q**(-.5-h)*jOverY/2;
  const rotation = cutoff*q**(-1-h)*v.f;
  const axial = cutoff*q**(-.5-h)*lam*v.jy + radialCutoff*q**d*v.j;
  return [radial*p[0]-rotation*p[1], radial*p[1]+rotation*p[0], axial];
}
