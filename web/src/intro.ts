import type { Quat, Vec3 } from './types';

export const INTRO_SHOT_SECONDS = 5.5;
export const INTRO_DURATION = 4 * INTRO_SHOT_SECONDS;
const FADE_IN = .35, PLAY_END = 4.85, FADE_OUT = 5.15;
const shots = [
  { title: 'Drawn inward.', caption: 'The camera moves closer as the core contracts. Fluid is drawn inward and stretched along the axis.', elevation: 8, azimuth: -90, roll: -8, fov: 62 },
  { title: 'Stretched upward.', caption: 'An oblique view of the last tenth of the interval. The ship moves independently of the fluid.', elevation: 38, azimuth: -35, roll: 12, fov: 58 },
  { title: 'Faster. Narrower.', caption: 'Looking down the axis at the last hundredth. White motion traces reveal the accelerating swirl.', elevation: 74, azimuth: 30, roll: -18, fov: 66 },
  { title: 'Closer to infinity.', caption: 'The last thousandth, magnified. Velocity keeps rising; this finite preview stops at t = 0.9999.', elevation: -28, azimuth: 140, roll: 20, fov: 60 },
];
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

/** Four linear-time replays at progressively finer, explicitly labelled scales.
 * A gentle camera zoom retains the core in view; flux-aware hidden sampling
 * accounts for the moving observation volume.
 * Camera motion never changes the scientific velocity field or tracer speed.
 */
export function sampleIntro(elapsed: number, timeMin = 0, timeMax = .9999) {
  const total = Math.max(0, elapsed), cycle = Math.floor(total / INTRO_DURATION);
  const within = total % INTRO_DURATION, shot = Math.min(3, Math.floor(within/INTRO_SHOT_SECONDS));
  const local = within-shot*INTRO_SHOT_SECONDS, phase = local/INTRO_SHOT_SECONDS, config = shots[shot];
  const startTime = Math.min(timeMax, 1-(1-timeMin)*10**(-shot));
  const play = Math.max(0, Math.min(1, (local-FADE_IN)/(PLAY_END-FADE_IN)));
  const time = startTime+(timeMax-startTime)*play;
  const remainingFraction = (1-time)/(1-startTime);
  // A smooth floor eases the camera to rest while the physical core keeps
  // contracting. The framing never cancels the full similarity contraction.
  const zoom = (Math.hypot(remainingFraction,.05)/Math.hypot(1,.05))**.22;
  const scale = .4*Math.sqrt(1-startTime)*zoom, distance = 3*scale;
  const azimuth = radians(config.azimuth+24*(smooth(phase)-.5));
  const elevation = radians(config.elevation+5*Math.sin(phase*Math.PI));
  const position: Vec3 = [distance*Math.cos(elevation)*Math.cos(azimuth), distance*Math.cos(elevation)*Math.sin(azimuth), distance*Math.sin(elevation)];
  return { cycle, shot, phase, time, startTime, title: config.title, caption: config.caption,
    opacity: smooth(local/FADE_IN)*(1-smooth((local-FADE_OUT)/(INTRO_SHOT_SECONDS-FADE_OUT))),
    position, orientation: orientation(position,radians(config.roll+3*Math.sin(phase*Math.PI))),
    scale, fov: config.fov-4*smooth(phase),
    exposure: 2.5+[0,.15,-.2,.1][shot]+.3*smooth(phase),
    near: shot===2?2:1.7, far: shot===2?4:4.3, focus: 2.8+.25*smooth(phase),
    shellFade: .8, blur: 18-5*smooth(phase), shellBokeh: 18-4*smooth(phase) };
}
