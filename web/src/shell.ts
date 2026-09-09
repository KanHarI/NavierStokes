/** Optical shell distances are multiples of the ship's observation scale. */
export const DEFAULT_SHELL_TRANSITION = 1;
export const DEFAULT_SHELL_OUTSIDE_BLUR = 24;
export const DEFAULT_SHELL_GUARD = .25;

export interface ShellSettings {
  near: number;
  far: number;
  transitionWidth?: number;
  /** Additional Gaussian standard deviation in render-target pixels. */
  outsideBlur?: number;
}

function settings(value: ShellSettings) {
  const near = value.near, far = value.far;
  const transitionWidth = value.transitionWidth ?? DEFAULT_SHELL_TRANSITION;
  const outsideBlur = value.outsideBlur ?? DEFAULT_SHELL_OUTSIDE_BLUR;
  if (![near, far, transitionWidth, outsideBlur].every(Number.isFinite)
      || near < 0 || far <= near || transitionWidth <= 0 || outsideBlur < 0
      || !Number.isFinite(far + transitionWidth)) {
    throw new Error('Invalid optical shell settings.');
  }
  return { near, far, transitionWidth, outsideBlur };
}

/** C2 ramp: both slope and curvature vanish at either endpoint. */
export function shellQuintic(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return Math.max(0, Math.min(1, x * x * x * (10 + x * (-15 + 6 * x))));
}

/**
 * Full visibility includes both configured shell boundaries. Only points
 * outside those boundaries soften and fade. The fading deliberately reduces
 * integrated light; increasing sigma alone must preserve integrated light.
 */
export function shellOptics(distance: number, config: ShellSettings) {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid shell distance.');
  const { near, far, transitionWidth, outsideBlur } = settings(config);
  const innerWidth = Math.min(near, transitionWidth);
  const inward = near > 0 && distance < near ? (near - distance) / innerWidth : 0;
  const outward = distance > far ? (distance - far) / transitionWidth : 0;
  const outsideFraction = Math.max(0, Math.min(1, Math.max(inward, outward)));
  const softness = shellQuintic(outsideFraction);
  return { visibility: 1 - softness, additionalSigma: outsideBlur * softness, outsideFraction };
}

/** Combine independent Gaussian widths before applying a rendering cost cap. */
export function shellGaussianSigma(baseSigma: number, additionalSigma: number, maximum = 64) {
  if (![baseSigma, additionalSigma, maximum].every(Number.isFinite)
      || baseSigma <= 0 || additionalSigma < 0 || maximum <= 0) {
    throw new Error('Invalid Gaussian width.');
  }
  return Math.min(maximum, Math.hypot(baseSigma, additionalSigma));
}

/**
 * Optical support contains the full transition. Guard bounds are strictly
 * beyond this support (except the physical origin), so birth/recycling can
 * occur where opacity is zero. Coordinates here remain in ship-scale units.
 */
export function shellBounds(config: ShellSettings, guardWidth = DEFAULT_SHELL_GUARD) {
  const { near, far, transitionWidth } = settings(config);
  if (!Number.isFinite(guardWidth) || guardWidth <= 0 || !Number.isFinite(far + transitionWidth + guardWidth)) {
    throw new Error('Invalid hidden shell guard width.');
  }
  const support: [number, number] = [Math.max(0, near - transitionWidth), far + transitionWidth];
  const guard: [number, number] = [Math.max(0, support[0] - guardWidth), support[1] + guardWidth];
  return { support, guard };
}

/** Same formula as the CPU helpers; validated uniforms are supplied by caller. */
export const SHELL_GLSL = `
float shellQuintic(float value){
  float x=clamp(value,0.,1.);
  return clamp(x*x*x*(10.+x*(-15.+6.*x)),0.,1.);
}
vec2 shellOpticalWeights(float distance,vec2 nearFar,float width,float outsideBlur){
  float innerWidth=min(nearFar.x,width);
  float inward=nearFar.x>0.&&distance<nearFar.x?(nearFar.x-distance)/innerWidth:0.;
  float outward=distance>nearFar.y?(distance-nearFar.y)/width:0.;
  float softness=shellQuintic(max(inward,outward));
  return vec2(1.-softness,outsideBlur*softness);
}
float shellGaussianSigma(float baseSigma,float additionalSigma,float maximumSigma){
  return min(maximumSigma,length(vec2(baseSigma,additionalSigma)));
}
vec2 shellSupport(vec2 nearFar,float width){
  return vec2(max(0.,nearFar.x-width),nearFar.y+width);
}
`;
