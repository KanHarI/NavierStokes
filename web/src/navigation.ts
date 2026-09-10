import { initialState, type AppState, type Quat, type Vec3 } from './types';

type Optics = Pick<AppState, 'near' | 'far' | 'focus' | 'blur' | 'shellBokeh' | 'fov' | 'exposure' | 'shellFade'>;
type OpticalOffset = { exposure: number; fov: number; depth: number; focus: number; blur: number; radarRange: number };
const neutralOptics = (): OpticalOffset => ({ exposure: 0, fov: 0, depth: 1, focus: 0, blur: 0, radarRange: 1 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function adjustOptics(base: Optics, offset: OpticalOffset): Optics {
  const near = clamp((base.focus - (base.focus - base.near) * offset.depth) * offset.radarRange, .05, 7.9);
  return { near, far: clamp((base.focus + (base.far - base.focus) * offset.depth) * offset.radarRange, near + .05, 8),
    focus: clamp((base.focus + offset.focus) * offset.radarRange, .1, 8), blur: clamp(base.blur + offset.blur, 0, 30),
    fov: clamp(base.fov + offset.fov, 25, 120), exposure: clamp(base.exposure + offset.exposure, -6, 8),
    // One bokeh gesture controls both sources of defocus. Otherwise the
    // boundary halo dominates while the HUD's ordinary-blur value changes.
    shellBokeh: clamp(base.shellBokeh + offset.blur * 48 / 30, 0, 48),
    shellFade: clamp(base.shellFade * offset.radarRange, .05, 2) };
}

function multiply(a: Quat, b: Quat): Quat {
  const [x, y, z, w] = a;
  const [bx, by, bz, bw] = b;
  return [w * bx + x * bw + y * bz - z * by,
    w * by - x * bz + y * bw + z * bx,
    w * bz + x * by - y * bx + z * bw,
    w * bw - x * bx - y * by - z * bz];
}

function normalize(q: Quat): Quat {
  const norm = Math.hypot(...q);
  return norm > 0 ? q.map(v => v / norm) as Quat : [0, 0, 0, 1];
}

function rotate(v: Vec3, q: Quat): Vec3 {
  const transformed = multiply(multiply(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [transformed[0], transformed[1], transformed[2]];
}

function isEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName));
}

/** Direct velocity flight. All rotations and translations use the ship's local frame. */
export function createNavigation(canvas: HTMLCanvasElement, state: AppState) {
  const keys = new Set<string>();
  let introLook: Quat = [0, 0, 0, 1];
  let introOffset: Vec3 = [0, 0, 0];
  let introOptics = neutralOptics();
  const touches = new Map<number, { x: number; y: number }>();
  const flightKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown',
    'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'ShiftLeft', 'ShiftRight',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']);
  state.ship.orientation = normalize(state.ship.orientation);

  const clearKeys = () => { keys.clear(); touches.clear(); state.boosting = false; };
  const keydown = (event: KeyboardEvent) => {
    if (isEditing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') {
      if (state.introActive) return;
      event.preventDefault();
      if (!event.repeat && state.flowAvailable && !state.loading) state.playing = !state.playing;
      return;
    }
    if (!state.pointerLocked || !flightKeys.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
    state.boosting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); state.boosting = keys.has('ShiftLeft') || keys.has('ShiftRight'); };
  const look = (dx: number, dy: number, sensitivity: number) => {
    const yaw = -dx * sensitivity / 2;
    const pitch = -dy * sensitivity / 2;
    const q = multiply(state.introActive ? introLook : state.ship.orientation, [0, Math.sin(yaw), 0, Math.cos(yaw)]);
    const looked = normalize(multiply(q, [Math.sin(pitch), 0, 0, Math.cos(pitch)]));
    if (state.introActive) introLook = looked;
    else state.ship.orientation = looked;
  };
  const mousemove = (event: MouseEvent) => {
    if (state.pointerLocked && document.pointerLockElement === canvas) look(event.movementX, event.movementY, .0018);
  };
  const touchEnabled = () => state.touchControls && state.hudActive && !state.screensaver && !state.touchSettings;
  const pointerdown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !touchEnabled() || touches.size >= 2) return;
    event.preventDefault();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
  };
  const span = () => {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const pointermove = (event: PointerEvent) => {
    const previous = touches.get(event.pointerId);
    if (!previous || !touchEnabled()) return;
    event.preventDefault();
    const oldSpan = span();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 1) look(event.clientX - previous.x, event.clientY - previous.y, .004);
    else {
      const newSpan = span();
      if (oldSpan < 8 || newSpan < 8) return;
      const ratio = oldSpan / newSpan;
      if (state.introActive) introOptics.radarRange = clamp(introOptics.radarRange * ratio, .01, 100);
      else Object.assign(state, adjustOptics(state, { ...neutralOptics(), radarRange: ratio }));
    }
  };
  const pointerup = (event: PointerEvent) => { touches.delete(event.pointerId); };
  canvas.addEventListener('pointerdown', pointerdown);
  canvas.addEventListener('pointermove', pointermove);
  canvas.addEventListener('pointerup', pointerup);
  canvas.addEventListener('pointercancel', pointerup);
  canvas.addEventListener('lostpointercapture', pointerup);
  const lockchange = () => {
    state.pointerLocked = document.pointerLockElement === canvas;
    clearKeys();
  };
  const visibilitychange = () => { if (document.hidden) clearKeys(); };
  document.addEventListener('keydown', keydown);
  document.addEventListener('keyup', keyup);
  document.addEventListener('mousemove', mousemove);
  document.addEventListener('pointerlockchange', lockchange);
  document.addEventListener('visibilitychange', visibilitychange);
  window.addEventListener('blur', clearKeys);

  return {
    rotateLook(delta: Quat) {
      if (state.introActive) introLook = normalize(multiply(introLook, delta));
      else state.ship.orientation = normalize(multiply(state.ship.orientation, delta));
    },
    applyIntroOrientation(base: Quat): Quat { return normalize(multiply(base, introLook)); },
    applyIntroPose(base: { position: Vec3; orientation: Quat; scale: number }) {
      const offset = rotate(introOffset, base.orientation);
      return {
        position: base.position.map((value, index) => value + base.scale * offset[index]) as Vec3,
        orientation: normalize(multiply(base.orientation, introLook)),
        scale: base.scale,
      };
    },
    applyIntroOptics(base: Optics): Optics {
      // Discard hidden overshoot once both blur values reach an endpoint,
      // so reversing the key immediately produces a visible response.
      introOptics.blur = clamp(introOptics.blur,
        Math.min(-base.blur, -base.shellBokeh * 30 / 48),
        Math.max(30 - base.blur, (48 - base.shellBokeh) * 30 / 48));
      return adjustOptics(base, introOptics);
    },
    resetIntroLook() { introLook = [0, 0, 0, 1]; introOffset = [0, 0, 0]; introOptics = neutralOptics(); clearKeys(); },
    update(elapsed: number) {
      const dt = Math.min(Math.max(elapsed, 0), 0.1);
      if (!state.pointerLocked) return;
      const axis = (positive: string, negative: string) => Number(keys.has(positive)) - Number(keys.has(negative));
      const opticalStep = {
        exposure: axis('Equal', 'Minus') * dt,
        fov: axis('BracketRight', 'BracketLeft') * 20 * dt,
        depth: Math.exp(axis('Digit2', 'Digit1') * .6 * dt),
        focus: axis('Digit4', 'Digit3') * .8 * dt,
        blur: axis('Digit6', 'Digit5') * 8 * dt,
        radarRange: Math.exp(axis('KeyX', 'KeyZ') * dt),
      };
      if (state.introActive) {
        introOptics.exposure = clamp(introOptics.exposure + opticalStep.exposure, -14, 14);
        introOptics.fov = clamp(introOptics.fov + opticalStep.fov, -120, 120);
        introOptics.depth = clamp(introOptics.depth * opticalStep.depth, .01, 100);
        introOptics.focus = clamp(introOptics.focus + opticalStep.focus, -8, 8);
        introOptics.blur = clamp(introOptics.blur + opticalStep.blur, -30, 30);
        introOptics.radarRange = clamp(introOptics.radarRange * opticalStep.radarRange, .01, 100);
      } else if (opticalStep.exposure || opticalStep.fov || opticalStep.depth !== 1 || opticalStep.focus || opticalStep.blur || opticalStep.radarRange !== 1) {
        Object.assign(state, adjustOptics(state, opticalStep));
      }
      const roll = axis('KeyQ', 'KeyE') * dt * 0.8;
      if (roll) {
        const orientation = normalize(multiply(state.introActive ? introLook : state.ship.orientation, [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)]));
        if (state.introActive) introLook = orientation;
        else state.ship.orientation = orientation;
      }
      const local: Vec3 = [axis('KeyD', 'KeyA'), axis('ArrowUp', 'ArrowDown'), axis('KeyS', 'KeyW')];
      const norm = Math.hypot(...local);
      if (!norm) return;
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
      const displacement = rotate(local.map(v => v / norm) as Vec3, state.introActive ? introLook : state.ship.orientation);
      const step = state.movementSpeed * (state.introActive ? 1 : state.ship.scale) * boost * dt;
      const position = state.introActive ? introOffset : state.ship.position;
      for (let i = 0; i < 3; i++) position[i] += displacement[i] * step;
    },
    reset() {
      const defaults = initialState();
      state.ship.position = [...defaults.ship.position];
      state.ship.orientation = normalize([...defaults.ship.orientation]);
      state.ship.scale = defaults.ship.scale;
      if (state.isCore) {
        const tau = 1 - state.time;
        state.ship.position[0] *= Math.sqrt(tau);
        state.ship.position[1] *= Math.sqrt(tau);
        state.ship.position[2] *= tau ** .495;
        state.ship.scale *= Math.sqrt(tau);
      }
      clearKeys();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', pointerdown);
      canvas.removeEventListener('pointermove', pointermove);
      canvas.removeEventListener('pointerup', pointerup);
      canvas.removeEventListener('pointercancel', pointerup);
      canvas.removeEventListener('lostpointercapture', pointerup);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
      document.removeEventListener('mousemove', mousemove);
      document.removeEventListener('pointerlockchange', lockchange);
      document.removeEventListener('visibilitychange', visibilitychange);
      window.removeEventListener('blur', clearKeys);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      state.pointerLocked = false;
      clearKeys();
    },
  };
}
