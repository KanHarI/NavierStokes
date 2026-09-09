import { initialState, type AppState, type Quat, type Vec3 } from './types';

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
  const flightKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF',
    'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'ShiftLeft', 'ShiftRight']);
  state.ship.orientation = normalize(state.ship.orientation);

  const clearKeys = () => keys.clear();
  const keydown = (event: KeyboardEvent) => {
    if (isEditing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat && state.flowAvailable && !state.loading) state.playing = !state.playing;
      return;
    }
    if (!state.pointerLocked || !flightKeys.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };
  const mousemove = (event: MouseEvent) => {
    if (!state.pointerLocked || document.pointerLockElement !== canvas) return;
    const sensitivity = 0.0018;
    const yaw = -event.movementX * sensitivity / 2;
    const pitch = -event.movementY * sensitivity / 2;
    const q = multiply(state.ship.orientation, [0, Math.sin(yaw), 0, Math.cos(yaw)]);
    state.ship.orientation = normalize(multiply(q, [Math.sin(pitch), 0, 0, Math.cos(pitch)]));
  };
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
    update(elapsed: number) {
      const dt = Math.min(Math.max(elapsed, 0), 0.1);
      if (!state.pointerLocked) return;
      const axis = (positive: string, negative: string) => Number(keys.has(positive)) - Number(keys.has(negative));
      const scaleStep = axis('KeyX', 'KeyZ') * dt;
      state.ship.scale = Math.max(1e-5, Math.min(1e4, state.ship.scale * Math.exp(scaleStep)));
      const roll = axis('KeyQ', 'KeyE') * dt * 0.8;
      if (roll) state.ship.orientation = normalize(multiply(state.ship.orientation, [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)]));
      const local: Vec3 = [axis('KeyD', 'KeyA'), axis('KeyR', 'KeyF'), axis('KeyS', 'KeyW')];
      const norm = Math.hypot(...local);
      if (!norm) return;
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
      const displacement = rotate(local.map(v => v / norm) as Vec3, state.ship.orientation);
      const step = state.movementSpeed * state.ship.scale * boost * dt;
      for (let i = 0; i < 3; i++) state.ship.position[i] += displacement[i] * step;
    },
    reset() {
      const defaults = initialState();
      state.ship.position = [...defaults.ship.position];
      state.ship.orientation = normalize([...defaults.ship.orientation]);
      state.ship.scale = defaults.ship.scale;
      clearKeys();
    },
    dispose() {
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
