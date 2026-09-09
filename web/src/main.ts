import './styles.css';
import { initialState } from './types';
import { createUI } from './ui';
import { createNavigation } from './navigation';
import { loadField, sampleVelocity } from './field';
import { advanceTime } from './time';
import { Renderer } from './renderer';
import { sampleIntro } from './intro';

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
let introElapsed = 0;
let introSegment = -1;
let introPriming = false;

function stopIntro(updateUI = true) {
  if (!state.introActive) return;
  state.introActive = false; state.playing = false;
  state.playbackSpeed = Math.max(.001, Math.min(10, state.playbackSpeed));
  canvas.style.transition = ''; canvas.style.opacity = '1';
  lastFrame = performance.now();
  if (updateUI) {
    const focusWasInIntro = document.activeElement?.closest('#intro-card');
    ui.update();
    if (focusWasInIntro) document.querySelector<HTMLButtonElement>('#enter-flight')?.focus({ preventScroll: true });
  }
}

function startIntro() {
  if (!renderer || !state.flowAvailable || !state.isCore) return;
  state.introActive = true; state.playing = true;
  state.independentDust = false; state.colorMode = 'white'; state.distanceSaturation = false;
  state.timeMode = 'linear'; state.density = 70; state.exposure = 2.5;
  state.densityCompensation = false;
  introElapsed = 0; introSegment = -1; introPriming = true; reseedAt = -1;
  state.introShot = 0; state.introProgress = 0; state.introRate = 1;
  state.introTitle = sampleIntro(0).title; state.introCaption = sampleIntro(0).caption;
  canvas.style.transition = 'none'; canvas.style.opacity = '0';
  lastFrame = performance.now(); ui.update();
  document.querySelector<HTMLButtonElement>('#explore-flow')?.focus({ preventScroll: true });
}

function reseed() {
  stopIntro();
  // Fade out the old population before replacing it, then GPU particle ages
  // fade in the new population. No overlapping light populations are added.
  canvas.style.transition = 'opacity 140ms ease';
  canvas.style.opacity = '0';
  reseedAt = performance.now() + 150;
}

const ui = createUI(container, state, {
  startIntro, stopIntro,
  reset() { navigation.reset(); reseed(); },
  reseed,
  scrub(time) {
    stopIntro();
    state.time = Math.max(state.timeMin, Math.min(state.timeMax, time));
    state.playing = false; reseed();
  },
  enterFlight() {
    stopIntro();
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
  state.introActive = false; canvas.style.opacity = '1';
  state.loading = false; state.playing = false; state.flowAvailable = false;
  state.status = error instanceof Error ? error.message : String(error);
  state.modelLabel = 'Preview unavailable'; state.modelDescription = state.status;
  const notice = document.createElement('div'); notice.className = 'load-error'; notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);max-width:420px;padding:24px;background:#111c25;border:1px solid #9b7350;border-radius:12px;color:#e4c9b0;font:15px/1.6 system-ui;z-index:4';
  notice.textContent = state.status; container.append(notice); ui.update();
}

async function start() {
  try {
    const field = await loadField(state.fieldKind);
    if (disposed) return;
    state.timeMin = field.manifest.time.start; state.timeMax = field.manifest.time.end;
    state.time = state.timeMin;
    state.modelLabel = field.manifest.label ?? 'Heat exterior · core not reconstructed';
    state.modelDescription = state.fieldKind === 'extended' ? `${field.manifest.model.scope}. Flow is defined around the core and becomes stationary beyond radius 8. Dust remains visible where velocity is zero. The full correction construction is not reconstructed.` : state.isCore ? `${field.manifest.model.scope}. This finite local profile has inward flow and axial stretching. Global matching and the full correction construction are not reconstructed. Use Reset view after scrubbing to frame the smaller core. Empty regions are outside the computed patch.` : `${field.manifest.model.scope}. This diagnostic annulus is not a reconstructed blowup. The central core is outside the dataset; empty regions are not stationary fluid.`;
    state.maxSpeed = state.isCore ? 100 : Math.hypot(...sampleVelocity(field, [field.manifest.domain.radialMin, 0, 0], state.timeMax)!);
    renderer = new Renderer(canvas, state, field); debug.renderer = renderer;
    state.flowAvailable = true; state.loading = false;
    state.status = 'Field ready · press play or enter flight';
    if (state.fieldKind === 'extended' && new URLSearchParams(location.search).get('intro') !== '0'
        && !matchMedia('(prefers-reduced-motion: reduce)').matches) startIntro();
    ui.update(); lastFrame = performance.now(); frameID = requestAnimationFrame(frame);
  } catch (error) { showError(error); }
}

function frame(now: number) {
  if (disposed || !renderer) return;
  const elapsed = (now - lastFrame) / 1000; lastFrame = now;
  const dt = document.hidden ? 0 : Math.min(.05, Math.max(0, elapsed));
  if (elapsed > 0 && elapsed < 1) state.fps = state.fps ? state.fps * .9 + .1 / elapsed : 1 / elapsed;
  const clockElapsed = document.hidden ? 0 : Math.max(0, elapsed);
  let timeDelta: number, transportDelta: number;
  if (state.introActive) {
    introElapsed += clockElapsed;
    const shot = sampleIntro(introElapsed, state.timeMin, state.timeMax);
    const segment = shot.cycle*4+shot.shot, restart = segment !== introSegment;
    timeDelta = restart ? 0 : Math.max(0, shot.time-state.time); transportDelta = timeDelta;
    if (restart) { renderer.reseed(); introSegment = segment; }
    state.time = shot.time; state.playing = shot.time < state.timeMax;
    state.introShot = shot.shot; state.introProgress = shot.phase;
    state.introRate = shot.rate;
    state.introTitle = shot.title; state.introCaption = shot.caption;
    state.introScaleRatio = Math.sqrt((1-shot.time)/(1-state.timeMin));
    state.introSpeedRatio = ((1-state.timeMin)/(1-shot.time))**(.5+renderer.field.manifest.model.h);
    state.ship.position = shot.position; state.ship.orientation = shot.orientation; state.ship.scale = shot.scale;
    state.near = shot.near; state.far = shot.far; state.focus = shot.focus; state.shellFade = shot.shellFade;
    state.blur = shot.blur; state.shellBokeh = shot.shellBokeh; state.fov = shot.fov;
    state.exposure = shot.exposure;
    state.playbackSpeed = (state.timeMax-shot.startTime)/4.5 * shot.rate;
    canvas.style.opacity = String(shot.opacity);
  } else {
    navigation.update(dt);
    const nextTime = state.playing
    ? advanceTime(state.time, state.timeMax, clockElapsed, state.playbackSpeed, state.timeMode)
    : state.time;
    timeDelta = nextTime - state.time;
    transportDelta = state.independentDust ? clockElapsed * state.dustSpeed : timeDelta;
    state.time = nextTime;
    if (state.time >= state.timeMax) state.playing = false;
  }
  const validShip = sampleVelocity(renderer.field, state.ship.position, state.time) !== null;
  state.status = !validShip ? 'Ship outside sampled patch · nearby valid dust only' :
    state.time >= state.timeMax ? 'Dataset endpoint · reset time to continue' :
    state.independentDust ? 'Independent dust · exploratory trajectories' :
    state.playing ? 'Fluid flow · synchronized tracers' : 'Paused · optics and flight remain active';
  if (reseedAt >= 0 && now >= reseedAt) {
    renderer.reseed(); reseedAt = -1; canvas.style.opacity = '1';
  }
  try { renderer.render(dt, transportDelta, timeDelta); }
  catch (error) { renderer.dispose(); showError(error); return; }
  if (state.introActive && introPriming) {
    renderer.finishFrame(); introPriming = false;
    introElapsed = 0; lastFrame = performance.now();
  }
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
const onManualInput = (event: Event) => {
  if (state.introActive && event.target instanceof Element && event.target.closest('input, select')) stopIntro(event.type !== 'input');
};
const onIntroKey = (event: KeyboardEvent) => {
  if (!state.introActive || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'Space' && event.target instanceof Element && event.target.closest('button, input, select, textarea, summary, a')) return;
  if (event.code === 'Escape' || event.code === 'Space') {
    event.preventDefault(); event.stopImmediatePropagation(); stopIntro();
  }
};
document.addEventListener('pointerdown', onManualInput, true);
document.addEventListener('input', onManualInput, true);
document.addEventListener('keydown', onIntroKey, true);
void start();

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true; cancelAnimationFrame(frameID); renderer?.dispose(); navigation.dispose(); ui.dispose();
  canvas.removeEventListener('webglcontextlost', onContextLost); document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('pointerdown', onManualInput, true); document.removeEventListener('input', onManualInput, true);
  document.removeEventListener('keydown', onIntroKey, true);
});
