import './styles.css';
import { initialState } from './types';
import { createUI } from './ui';
import { createNavigation } from './navigation';
import { loadField, sampleVelocity } from './field';
import { Renderer } from './renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#space')!;
const container = document.querySelector<HTMLElement>('#interface')!;
const state = initialState();
const navigation = createNavigation(canvas, state);
let renderer: Renderer | undefined;
let frameID = 0;
let disposed = false;
let lastFrame = performance.now();
let lastUI = 0;
let reseedAt = -1;

function reseed() {
  // Fade out the old population before replacing it, then GPU particle ages
  // fade in the new population. No overlapping light populations are added.
  canvas.style.transition = 'opacity 140ms ease';
  canvas.style.opacity = '0';
  reseedAt = performance.now() + 150;
}

const ui = createUI(container, state, {
  reset() { navigation.reset(); reseed(); },
  reseed,
  scrub(time) {
    state.time = Math.max(state.timeMin, Math.min(state.timeMax, time));
    state.playing = false; reseed();
  },
  enterFlight() {
    if (typeof canvas.requestPointerLock !== 'function') {
      state.status = 'Pointer capture is unavailable in this browser.'; ui.update(); return;
    }
    const request = canvas.requestPointerLock();
    if (request && typeof request.catch === 'function') request.catch(() => {
      state.status = 'Click the view again to enable mouse flight.'; ui.update();
    });
  },
});

const debug = { state, renderer, sampleVelocity: (p: number[], time = state.time) => renderer ? sampleVelocity(renderer.field, p, time) : null };
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { __observatory: debug });
}

function showError(error: unknown) {
  state.loading = false; state.playing = false; state.flowAvailable = false;
  state.status = error instanceof Error ? error.message : String(error);
  state.modelLabel = 'Preview unavailable'; state.modelDescription = state.status;
  const notice = document.createElement('div'); notice.className = 'load-error'; notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);max-width:420px;padding:24px;background:#111c25;border:1px solid #9b7350;border-radius:12px;color:#e4c9b0;font:15px/1.6 system-ui;z-index:4';
  notice.textContent = state.status; container.append(notice); ui.update();
}

async function start() {
  try {
    const field = await loadField();
    if (disposed) return;
    state.timeMin = field.manifest.time.start; state.timeMax = field.manifest.time.end;
    state.time = state.timeMin;
    state.modelLabel = field.manifest.label ?? 'Heat exterior · core not reconstructed';
    state.modelDescription = `${field.manifest.model.scope}. This diagnostic annulus is not a reconstructed blowup. The central core is outside the dataset; empty regions are not stationary fluid.`;
    state.maxSpeed = Math.hypot(...sampleVelocity(field, [field.manifest.domain.radialMin, 0, 0], state.timeMax)!);
    renderer = new Renderer(canvas, state, field); debug.renderer = renderer;
    state.flowAvailable = true; state.loading = false;
    state.status = 'Exterior field ready · press play or enter flight';
    ui.update(); lastFrame = performance.now(); frameID = requestAnimationFrame(frame);
  } catch (error) { showError(error); }
}

function frame(now: number) {
  if (disposed || !renderer) return;
  const elapsed = (now - lastFrame) / 1000; lastFrame = now;
  const dt = document.hidden ? 0 : Math.min(.05, Math.max(0, elapsed));
  if (elapsed > 0 && elapsed < 1) state.fps = state.fps ? state.fps * .9 + .1 / elapsed : 1 / elapsed;
  navigation.update(dt);
  let timeDelta = state.playing ? dt * state.playbackSpeed : 0;
  let transportDelta = state.independentDust ? dt * state.dustSpeed : timeDelta;
  const limit = Math.min(1, .03 / Math.max(Math.abs(timeDelta), Math.abs(transportDelta), 1e-9));
  timeDelta *= limit; transportDelta *= limit;
  if (state.time + timeDelta >= state.timeMax) {
    timeDelta = Math.max(0, state.timeMax - state.time);
    if (!state.independentDust) transportDelta = timeDelta;
    state.playing = false;
  }
  state.time += timeDelta;
  const validShip = sampleVelocity(renderer.field, state.ship.position, state.time) !== null;
  state.status = limit < 1 ? 'Transport limited · both clocks slowed together' :
    !validShip ? 'Ship outside sampled annulus · nearby valid dust only' :
    state.time >= state.timeMax ? 'Dataset endpoint · reset time to continue' :
    state.independentDust ? 'Independent dust · exploratory trajectories' :
    state.playing ? 'Exterior flow · synchronized tracers' : 'Paused · optics and flight remain active';
  if (reseedAt >= 0 && now >= reseedAt) {
    renderer.reseed(); reseedAt = -1; canvas.style.opacity = '1';
  }
  try { renderer.render(dt, transportDelta, timeDelta); }
  catch (error) { renderer.dispose(); showError(error); return; }
  if (now - lastUI > 100) { ui.update(); lastUI = now; }
  frameID = requestAnimationFrame(frame);
}

const onContextLost = (event: Event) => {
  event.preventDefault(); cancelAnimationFrame(frameID); state.playing = false;
  state.status = 'Graphics context lost. Reload the page to restore the observatory.';
  showError(new Error(state.status));
};
canvas.addEventListener('webglcontextlost', onContextLost);
const onVisibility = () => { lastFrame = performance.now(); };
document.addEventListener('visibilitychange', onVisibility);
void start();

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true; cancelAnimationFrame(frameID); renderer?.dispose(); navigation.dispose(); ui.dispose();
  canvas.removeEventListener('webglcontextlost', onContextLost); document.removeEventListener('visibilitychange', onVisibility);
});
