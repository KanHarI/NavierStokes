/** Three-sigma Gaussian support, expressed in elliptical q coordinates. */
export const PARTICLE_PROFILE_CUTOFF = 4.5;
export const PARTICLE_PROFILE_MASS = 1 - Math.exp(-PARTICLE_PROFILE_CUTOFF);

export interface ParticleProfileParameters {
  /** Center intensity, between zero and display white. */
  peak: number;
  /** White plateau ends at this elliptical q coordinate. */
  plateau: number;
  /** Truncated Gaussian edge ends at this elliptical q coordinate. */
  cutoff: number;
}

/** q = .5 * ((x / sigmaX)^2 + (y / sigmaY)^2).
 * The area element after integrating angle is 2*pi*sigmaX*sigmaY*dq.
 * Below white, mass = peak*C. Above white, mass = plateau+C. Therefore
 * either profile integrates to the supplied light, with unchanged axis ratio.
 * This is the uncapped mathematical profile; rendering budgets are separate.
 */
export function particleProfileParameters(light: number, sigmaX: number, sigmaY: number): ParticleProfileParameters {
  if (!Number.isFinite(light) || light < 0 || !Number.isFinite(sigmaX) || sigmaX <= 0
      || !Number.isFinite(sigmaY) || sigmaY <= 0) throw new RangeError('Particle light must be nonnegative and Gaussian widths positive and finite.');
  const area = 2 * Math.PI * sigmaX * sigmaY;
  const mass = light / area;
  if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(mass)) throw new RangeError('Particle profile exceeds finite numerical range.');
  const plateau = Math.max(0, mass - PARTICLE_PROFILE_MASS);
  return { peak: Math.min(1, mass / PARTICLE_PROFILE_MASS), plateau, cutoff: plateau + PARTICLE_PROFILE_CUTOFF };
}

/** Intensity at an elliptical squared radius. Positive infinity is outside. */
export function particleProfileIntensity(q: number, parameters: ParticleProfileParameters): number {
  if (Number.isNaN(q) || q < 0) throw new RangeError('Elliptical radius must be nonnegative.');
  if (q > parameters.cutoff) return 0;
  return parameters.peak * Math.exp(-Math.max(0, q - parameters.plateau));
}

/** Shared vertex/fragment helpers. Inputs must obey the CPU preconditions.
 * Parameters are (peak intensity, white plateau q, support cutoff q).
 * Support semi-axes are sigma * sqrt(2 * parameters.z).
 */
export const PARTICLE_PROFILE_GLSL = `
const float PARTICLE_PROFILE_CUTOFF = 4.5;
const float PARTICLE_PROFILE_MASS = ${PARTICLE_PROFILE_MASS.toPrecision(17)};
vec3 particleProfileParameters(float light, vec2 sigma) {
  float mass = light / (6.283185307179586 * sigma.x * sigma.y);
  float plateau = max(0., mass - PARTICLE_PROFILE_MASS);
  return vec3(min(1., mass / PARTICLE_PROFILE_MASS), plateau, plateau + PARTICLE_PROFILE_CUTOFF);
}
float particleProfileIntensity(float q, vec3 parameters) {
  return q > parameters.z ? 0. : parameters.x * exp(-max(0., q - parameters.y));
}
`;
