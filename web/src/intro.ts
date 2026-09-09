import type { Quat, Vec3 } from './types';

export const INTRO_MIN_SECONDS = 5;
export const INTRO_MAX_SECONDS = 30;
export const INTRO_FADE_SECONDS = .35;
const FADE_SECONDS = INTRO_FADE_SECONDS;

/** Integer-seeded randomness keeps every generated shot reproducible for audits. */
function randomSource(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Independent continuous choices, coupled later to keep the core in focus. */
export function generateIntroClip(seed: number, index: number) {
  const random = randomSource((seed ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0);
  const between = (a: number, b: number) => a + (b-a)*random();
  return {
    index, duration: between(INTRO_MIN_SECONDS, INTRO_MAX_SECONDS),
    // Always introduce the complete interval first; subsequent windows explore
    // any magnification up to the last thousandth, without a four-shot cycle.
    decades: index === 0 ? 0 : between(0, 3),
    azimuth: between(-180, 180), elevation: Math.asin(between(-.97, .97))*180/Math.PI,
    orbit: between(18, 65)*(random() < .5 ? -1 : 1), lift: between(-8, 8),
    roll: between(-30, 30), rollDrift: between(-10, 10),
    framing: between(.34, .46), zoomPower: between(.17, .25),
    fov: between(56, 72), fovDrift: between(-7, 4),
    perspective: between(.9, 1.25), perspectiveDrift: between(-.08, .08),
    focus: between(2.7, 3.3), focusDrift: between(-.18, .18),
    frontDepth: between(.65, 1.15), backDepth: between(.8, 1.35),
    depthDrift: between(-.12, .12), shellFade: between(.6, .95),
    blur: between(11, 20), blurDrift: between(-4, 3),
    shellBokeh: between(14, 25), bokehDrift: between(-4, 4),
    exposure: between(2.2, 2.7), exposureDrift: between(.1, .4),
    density: between(55, 75),
  };
}

const radians = (degrees: number) => degrees * Math.PI / 180;
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t*t*t*(10+t*(-15+6*t)); };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v: Vec3): Vec3 => v.map(x => x/Math.hypot(...v)) as Vec3;

/** Camera-local -Z points at the origin; roll is an artistic camera choice. */
function orientation(position: Vec3, roll: number): Quat {
  const back = unit(position), right = unit(cross([0, 0, 1], back)), up = cross(back, right);
  const m00=right[0], m01=up[0], m02=back[0], m10=right[1], m11=up[1], m12=back[1], m20=right[2], m21=up[2], m22=back[2];
  let q: Quat; const trace = m00+m11+m22;
  if (trace > 0) { const s=2*Math.sqrt(trace+1); q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4]; }
  else if (m00>m11 && m00>m22) { const s=2*Math.sqrt(1+m00-m11-m22); q=[s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s]; }
  else if (m11>m22) { const s=2*Math.sqrt(1+m11-m00-m22); q=[(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s]; }
  else { const s=2*Math.sqrt(1+m22-m00-m11); q=[(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s]; }
  const s=Math.sin(roll/2), c=Math.cos(roll/2), [x,y,z,w]=q;
  return unitQuaternion([c*x+s*y,c*y-s*x,c*z+s*w,c*w-s*z]);
}
function unitQuaternion(q: Quat): Quat { const n=Math.hypot(...q); return q.map(x=>x/n) as Quat; }

/** Sample one generated approach. Physical time is linear during its active
 * interval; the camera never changes the scientific velocity field. */
export function sampleIntroClip(config: ReturnType<typeof generateIntroClip>, local: number,
  timeMin = 0, timeMax = .9999) {
  const duration = config.duration;
  const phase = Math.max(0, Math.min(1, local/duration));
  const viewPhase = Math.min(phase, (duration-FADE_SECONDS)/duration), ease = smooth(viewPhase);
  const startTime = Math.max(timeMin, Math.min(timeMax, 1-(1-timeMin)*10**(-config.decades)));
  const playSeconds = duration-2*FADE_SECONDS;
  const play = Math.max(0, Math.min(1, (local-FADE_SECONDS)/playSeconds));
  const time = startTime+(timeMax-startTime)*play;
  const remainingFraction = (1-time)/(1-startTime);
  // The camera eases to rest while the core continues its physical contraction.
  const zoom = (Math.hypot(remainingFraction,.05)/Math.hypot(1,.05))**config.zoomPower;
  const scale = config.framing*Math.sqrt(1-startTime)*zoom;
  // Dolly and viewing radii move together; compensating FOV changes perspective
  // while approximately retaining the core's apparent size.
  const perspective = config.perspective+config.perspectiveDrift*ease;
  const focus = (config.focus+config.focusDrift*ease)*perspective;
  const distance = focus*scale;
  const depth = 1+config.depthDrift*ease;
  const azimuth = radians(config.azimuth+config.orbit*(ease-.5));
  const elevation = radians(Math.max(-85, Math.min(85, config.elevation+config.lift*Math.sin(viewPhase*Math.PI))));
  const position: Vec3 = [distance*Math.cos(elevation)*Math.cos(azimuth), distance*Math.cos(elevation)*Math.sin(azimuth), distance*Math.sin(elevation)];
  const axial = Math.abs(config.elevation) > 55;
  const title = axial ? 'Inside the accelerating swirl.' : 'A core drawn ever narrower.';
  const caption = `${axial ? 'Looking along the axis reveals rotation.' : 'An orbit reveals inward flow and axial stretching.'} Linear time from t = ${startTime.toFixed(4)} to ${timeMax.toFixed(4)}; the preview stops before the singularity.`;
  return { shot: config.index, duration, phase, time, startTime, title, caption,
    playbackSpeed: (timeMax-startTime)/playSeconds,
    opacity: smooth(local/FADE_SECONDS)*(1-smooth((local-(duration-FADE_SECONDS))/FADE_SECONDS)),
    position, orientation: orientation(position,radians(config.roll+config.rollDrift*ease)), scale,
    perspective, fov: 2*Math.atan(Math.tan(radians(config.fov+config.fovDrift*ease)/2)/perspective)*180/Math.PI,
    exposure: config.exposure+config.exposureDrift*ease,
    near: focus-config.frontDepth*perspective*depth,
    far: focus+config.backDepth*perspective*depth, focus,
    shellFade: config.shellFade*perspective, blur: config.blur+config.blurDrift*ease,
    shellBokeh: config.shellBokeh+config.bokehDrift*ease, density: config.density };
}

/** Constant memory and constant work on ordinary frames. Rewinding reproduces
 * the same seed; a new director creates a new procedural sequence. */
export function createIntroDirector(seed: number) {
  let index = 0, start = 0, config = generateIntroClip(seed, 0);
  return { sample(elapsed: number, timeMin = 0, timeMax = .9999) {
    if (!Number.isFinite(elapsed)) throw new Error('Intro elapsed time must be finite.');
    elapsed = Math.max(0, elapsed);
    if (elapsed < start) { index = 0; start = 0; config = generateIntroClip(seed, 0); }
    while (elapsed >= start+config.duration) {
      start += config.duration; config = generateIntroClip(seed, ++index);
    }
    return sampleIntroClip(config, elapsed-start, timeMin, timeMax);
  } };
}
