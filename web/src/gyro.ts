import type { Quat } from './types';

// W3C Device Orientation: intrinsic Z(alpha), X(beta), Y(gamma), with
// device axes right / up / out of screen. Calibration removes its world frame.
// https://www.w3.org/TR/orientation-event/#deviceorientation
const radians = Math.PI / 180;
const identity = (): Quat => [0, 0, 0, 1];
const inverse = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w];
function multiply([x, y, z, w]: Quat, [a, b, c, d]: Quat): Quat {
  return [w*a+x*d+y*c-z*b, w*b-x*c+y*d+z*a, w*c+x*b-y*a+z*d, w*d-x*a-y*b-z*c];
}
function normalize(q: Quat): Quat {
  const length = Math.hypot(...q);
  return length > 0 ? q.map(value => value / length) as Quat : identity();
}
function screenAngle() {
  const modern = window.screen.orientation?.angle;
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof modern === 'number' && Number.isFinite(modern) ? modern
    : typeof legacy === 'number' && Number.isFinite(legacy) ? legacy : 0;
}
function sensorQuaternion(alpha: number, beta: number, gamma: number, angle: number): Quat {
  const [a, b, g, s] = [alpha, beta, gamma, -angle].map(value => value * radians / 2);
  return normalize(multiply(multiply(multiply(
    [0, 0, Math.sin(a), Math.cos(a)], [Math.sin(b), 0, 0, Math.cos(b)]),
    [0, Math.sin(g), 0, Math.cos(g)]), [0, 0, Math.sin(s), Math.cos(s)]));
}
function interpolate(from: Quat, to: Quat, amount: number): Quat {
  let dot = from.reduce((sum, value, index) => sum + value * to[index], 0);
  // q and -q encode the same orientation: alpha crossing 360 must not spin.
  if (dot < 0) { to = to.map(value => -value) as Quat; dot = -dot; }
  if (dot > .9995) return normalize(from.map((value, index) => value + amount * (to[index] - value)) as Quat);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const denominator = Math.sin(angle);
  const a = Math.sin((1 - amount) * angle) / denominator;
  const b = Math.sin(amount * angle) / denominator;
  return normalize(from.map((value, index) => value * a + to[index] * b) as Quat);
}

/** Optional sensor steering. Call enable directly from a user gesture.
 * update returns an incremental local-camera rotation to post-multiply into
 * user steering, never an absolute horizon or procedural camera orientation.
 */
export function createGyroSteering() {
  let enabled = false, disposed = false, generation = 0;
  let pending: Promise<boolean> | null = null;
  let target: Quat | null = null, filtered: Quat | null = null;
  let lastSample: number | null = null, waitingSince = 0, angle = screenAngle();
  let invalidReading = false, message = 'Motion steering is off.';
  const staleAfter = 1500;

  function recalibrate() {
    target = filtered = null; lastSample = null; invalidReading = false;
    waitingSince = performance.now(); angle = screenAngle();
  }
  function onReading(event: DeviceOrientationEvent) {
    if (!enabled || document.hidden) return;
    const values = [event.alpha, event.beta, event.gamma];
    if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) {
      target = filtered = null; invalidReading = true; return;
    }
    const now = performance.now(), nextAngle = screenAngle();
    if (nextAngle !== angle || (lastSample !== null && now - lastSample > staleAfter)) recalibrate();
    target = sensorQuaternion(event.alpha!, event.beta!, event.gamma!, nextAngle);
    if (!filtered) filtered = target;
    lastSample = now; angle = nextAngle; invalidReading = false;
  }
  const onVisibility = () => { recalibrate(); };
  function detach() {
    window.removeEventListener('deviceorientation', onReading);
    window.removeEventListener('orientationchange', recalibrate);
    window.screen.orientation?.removeEventListener('change', recalibrate);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  function disable() {
    generation++; enabled = false; detach(); recalibrate(); message = 'Motion steering is off.';
  }
  function enable(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (enabled) return Promise.resolve(true);
    if (pending) return pending;
    if (!window.isSecureContext || typeof window.DeviceOrientationEvent === 'undefined') {
      message = 'Motion sensors are unavailable here. Drag to look around.';
      return Promise.resolve(false);
    }
    const token = ++generation;
    const Sensor = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<PermissionState>;
    };
    message = 'Requesting motion access…';
    pending = (async () => {
      try {
        // Do not precede this with an await: iOS requires the tap activation.
        const permission = Sensor.requestPermission ? await Sensor.requestPermission.call(Sensor) : 'granted';
        if (token !== generation || disposed) return false;
        if (permission !== 'granted') {
          message = 'Motion access was denied. Drag to look around.'; return false;
        }
        enabled = true; recalibrate();
        window.addEventListener('deviceorientation', onReading);
        window.addEventListener('orientationchange', recalibrate);
        window.screen.orientation?.addEventListener('change', recalibrate);
        document.addEventListener('visibilitychange', onVisibility);
        return true;
      } catch {
        if (token === generation) message = 'Motion access is unavailable. Drag to look around.';
        return false;
      }
    })();
    const result = pending;
    void result.finally(() => { if (pending === result) pending = null; });
    return result;
  }
  return {
    enable, disable, recalibrate,
    update(dt: number): Quat | null {
      if (!enabled || !target || !filtered || !Number.isFinite(dt) || dt <= 0
          || lastSample === null || performance.now() - lastSample > staleAfter || document.hidden) return null;
      const next = interpolate(filtered, target, 1 - Math.exp(-Math.min(dt, .1) / .065));
      let delta = normalize(multiply(inverse(filtered), next));
      filtered = next;
      if (delta[3] < 0) delta = delta.map(value => -value) as Quat;
      return Math.hypot(delta[0], delta[1], delta[2]) < 1e-8 ? null : delta;
    },
    status() {
      if (!enabled) return message;
      if (invalidReading) return 'Motion data unavailable. Drag to look around.';
      if (!target) return performance.now() - waitingSince > 2500
        ? 'No motion data received. Drag to look around.' : 'Waiting for motion data…';
      if (lastSample === null || performance.now() - lastSample > staleAfter) return 'Motion data paused. Drag to look around.';
      return 'Motion steering on.';
    },
    dispose() { disable(); disposed = true; },
  };
}
