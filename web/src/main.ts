import './styles.css';
import { initialState } from './types';
import { createUI } from './ui';
import { createNavigation } from './navigation';
import { loadField, sampleVelocity, type FieldData } from './field';
import { advanceTime } from './time';
import { Renderer } from './renderer';
import { createIntroDirector, INTRO_FADE_SECONDS } from './intro';
import { createGyroSteering } from './gyro';

const canvas = document.querySelector<HTMLCanvasElement>('#space')!;
const container = document.querySelector<HTMLElement>('#interface')!;
canvas.tabIndex = -1;
const state = initialState();
const navigation = createNavigation(canvas, state);
const gyro = createGyroSteering();
let renderer: Renderer | undefined;
let cachedField: FieldData | undefined;
let graphicsLost = false;
let graphicsRecoveries = 0;
let resumeIntroAfterRecovery = false;
let recoveryHUD = false;
let gyroRequest = 0;
let frameID = 0;
let disposed = false;
let lastFrame = performance.now();
let lastUI = 0;
let reseedAt = -1;
let introDirector = createIntroDirector(0);
let introElapsed = 0;
let introSegment = -1;
let introPriming = false;
let introClipStart = 0;
let introFading = false;
let introBlack = false;
let introFadeElapsed = 0;
let firstFrameReady = false;
const startup = { dataStart: 0, dataReady: 0, rendererReady: 0, firstFrameReady: 0 };
const startupLoader = document.querySelector<HTMLElement>('#startup-loader');
const startupStage = document.querySelector<HTMLElement>('#startup-stage');

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
  navigation.resetIntroLook();
  gyro.recalibrate();
  state.hudActive = false;
  state.touchSettings = false;
  state.introActive = true; state.playing = true;
  state.independentDust = false; state.colorMode = 'white'; state.distanceSaturation = false;
  state.timeMode = 'linear'; state.density = 70; state.exposure = 2.5;
  state.densityCompensation = false;
  introElapsed = 0; introSegment = -1; introPriming = true; reseedAt = -1;
  introClipStart = 0; introFading = false; introBlack = false; introFadeElapsed = 0;
  introDirector = createIntroDirector(crypto.getRandomValues(new Uint32Array(1))[0]);
  const first = introDirector.sample(0, state.timeMin, state.timeMax);
  state.introShot = 0; state.introProgress = 0; state.introDuration = first.duration;
  state.introTitle = first.title; state.introCaption = first.caption;
  canvas.style.transition = 'none'; canvas.style.opacity = '0';
  lastFrame = performance.now(); ui.update();
  canvas.focus({ preventScroll: true });
}

function reseed() {
  stopIntro();
  // Fade out the old population before replacing it, then GPU particle ages
  // fade in the new population. No overlapping light populations are added.
  canvas.style.transition = 'opacity 140ms ease';
  canvas.style.opacity = '0';
  reseedAt = performance.now() + 150;
}

function lookAround() {
  if (state.touchControls) {
    state.hudActive = true; state.touchSettings = false; ui.update();
    return;
  }
  if (typeof canvas.requestPointerLock !== 'function') {
    state.status = 'Pointer capture is unavailable in this browser.'; ui.update(); return;
  }
  state.hudActive = true; ui.update();
  canvas.focus({ preventScroll: true });
  const request = canvas.requestPointerLock();
  if (request && typeof request.catch === 'function') request.catch(() => {
    state.hudActive = false; state.status = 'Click the view again to enable mouse look.'; ui.update();
  });
}

function enterFlight() { stopIntro(); lookAround(); }

async function toggleGyro() {
  if (state.gyroPending || graphicsLost) return;
  if (state.gyroActive) { gyro.disable(); state.gyroActive = false; }
  else {
    const request = ++gyroRequest;
    state.gyroPending = true;
    state.gyroStatus = 'Requesting Gyro access…'; ui.update();
    const enabled = await gyro.enable();
    if (disposed || request !== gyroRequest) return;
    state.gyroActive = enabled;
    state.gyroPending = false;
  }
  // A native permission sheet can suspend RAF without changing visibility.
  // Permission time belongs to the paused viewer, never a catch-up step.
  lastFrame = performance.now();
  state.gyroStatus = gyro.status(); ui.update();
}

function updateNavigation(dt: number) {
  if (state.gyroActive && state.hudActive && !state.touchSettings && !state.screensaver) {
    const delta = gyro.update(dt);
    if (delta) navigation.rotateLook(delta);
    state.gyroStatus = gyro.status();
  } else gyro.recalibrate();
  navigation.update(dt);
}

function startScreensaver() {
  if (!state.flowAvailable || !state.isCore) return;
  if (!state.introActive) startIntro();
  state.hudActive = false; state.screensaver = true;
  navigation.resetIntroLook(); ui.update();
  canvas.focus({ preventScroll: true });
  if (document.pointerLockElement) document.exitPointerLock();
  // The same text-free presentation also works in the browser viewport when
  // fullscreen is unavailable or declined by the browser.
  document.documentElement.requestFullscreen?.().catch(() => {});
}
function stopScreensaver() {
  state.screensaver = false; ui.update();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
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
  enterFlight, lookAround, startScreensaver, returnToAuto, toggleGyro,
});

const debug = { state, renderer, startup, sampleVelocity: (p: number[], time = state.time) => renderer ? sampleVelocity(renderer.field, p, time) : null };
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { __observatory: debug });
}

function showError(error: unknown) {
  state.screensaver = false;
  if (startupLoader) startupLoader.hidden = true;
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
    startup.dataStart = performance.now();
    if (startupStage) startupStage.textContent = 'Loading flow data…';
    const field = await loadField(state.fieldKind);
    cachedField = field;
    startup.dataReady = performance.now();
    if (startupStage) startupStage.textContent = 'Preparing the view…';
    if (disposed) return;
    state.timeMin = field.manifest.time.start; state.timeMax = field.manifest.time.end;
    state.time = state.timeMin;
    state.modelLabel = field.manifest.label ?? 'Heat exterior · core not reconstructed';
    state.modelDescription = state.fieldKind === 'extended' ? `${field.manifest.model.scope}. Flow is defined around the core and becomes stationary beyond radius 8. Dust remains visible where velocity is zero. The full correction construction is not reconstructed.` : state.isCore ? `${field.manifest.model.scope}. This finite local profile has inward flow and axial stretching. Global matching and the full correction construction are not reconstructed. Use Reset view after scrubbing to frame the smaller core. Empty regions are outside the computed patch.` : `${field.manifest.model.scope}. This diagnostic annulus is not a reconstructed blowup. The central core is outside the dataset; empty regions are not stationary fluid.`;
    state.maxSpeed = state.isCore ? 100 : Math.hypot(...sampleVelocity(field, [field.manifest.domain.radialMin, 0, 0], state.timeMax)!);
    renderer = new Renderer(canvas, state, field); debug.renderer = renderer;
    startup.rendererReady = performance.now();
    state.flowAvailable = true; state.loading = false;
    state.status = 'Field ready · press play or enter flight';
    if (state.fieldKind === 'extended' && new URLSearchParams(location.search).get('intro') !== '0'
        && !matchMedia('(prefers-reduced-motion: reduce)').matches) startIntro();
    ui.update(); lastFrame = performance.now(); frameID = requestAnimationFrame(frame);
  } catch (error) { if (!graphicsLost) showError(error); }
}

function frame(now: number) {
  if (disposed || graphicsLost || !renderer) return;
  // A queued RAF timestamp can predate the preceding GPU completion barrier.
  // Use entry time consistently with that barrier so its stall cannot be
  // counted again as elapsed fade time on the next frame.
  now = performance.now();
  const elapsed = (now - lastFrame) / 1000; lastFrame = now;
  if (state.gyroPending) {
    frameID = requestAnimationFrame(frame);
    return;
  }
  const dt = document.hidden ? 0 : Math.min(.05, Math.max(0, elapsed));
  if (elapsed > 0 && elapsed < 1) state.fps = state.fps ? state.fps * .9 + .1 / elapsed : 1 / elapsed;
  const clockElapsed = document.hidden ? 0 : Math.max(0, elapsed);
  // The expensive endpoint frame must finish before the fade clock starts.
  // Fade the retained canvas image: do not reproject or reseed its dust, remove
  // its motion exposure, or let a slow GPU skip straight into the next clip.
  if (state.introActive && introFading) {
    introFadeElapsed = Math.min(INTRO_FADE_SECONDS, introFadeElapsed+clockElapsed);
    const t = introFadeElapsed/INTRO_FADE_SECONDS;
    canvas.style.opacity = String(1-t*t*t*(10+t*(-15+6*t)));
    state.introProgress = (state.introDuration-INTRO_FADE_SECONDS+introFadeElapsed)/state.introDuration;
    if (introFadeElapsed >= INTRO_FADE_SECONDS) {
      canvas.style.opacity = '0'; introFading = false; introBlack = true;
    }
    if (now-lastUI > 100) { ui.update(); lastUI = now; }
    frameID = requestAnimationFrame(frame);
    return; // One fully black presentation precedes the next population reset.
  }
  let timeDelta: number, transportDelta: number;
  let introAtEndpoint = false;
  if (state.introActive) {
    if (introBlack) {
      introClipStart += state.introDuration; introElapsed = introClipStart;
      introBlack = false; introPriming = true;
    } else {
      const endpoint = introClipStart+state.introDuration-INTRO_FADE_SECONDS;
      introElapsed = Math.min(endpoint, introElapsed+clockElapsed);
      introAtEndpoint = introElapsed >= endpoint;
    }
    const shot = introDirector.sample(introElapsed, state.timeMin, state.timeMax);
    if (introAtEndpoint) shot.time = state.timeMax;
    const segment = shot.shot, restart = segment !== introSegment;
    timeDelta = restart ? 0 : Math.max(0, shot.time-state.time); transportDelta = timeDelta;
    if (restart) { renderer.reseed(); navigation.resetIntroLook(); gyro.recalibrate(); introSegment = segment; state.density = shot.density; }
    state.time = shot.time; state.playing = shot.time < state.timeMax;
    state.introShot = shot.shot; state.introProgress = shot.phase;
    state.introDuration = shot.duration;
    state.introTitle = shot.title; state.introCaption = shot.caption;
    state.introScaleRatio = Math.sqrt((1-shot.time)/(1-state.timeMin));
    state.introSpeedRatio = ((1-state.timeMin)/(1-shot.time))**(.5+renderer.field.manifest.model.h);
    updateNavigation(dt);
    const pose = navigation.applyIntroPose({ position: shot.position, orientation: shot.orientation, scale: shot.scale });
    state.ship.position = pose.position; state.ship.orientation = pose.orientation; state.ship.scale = pose.scale;
    const optics = navigation.applyIntroOptics(shot);
    state.near = optics.near; state.far = optics.far; state.focus = optics.focus; state.shellFade = optics.shellFade;
    state.blur = optics.blur; state.shellBokeh = optics.shellBokeh; state.fov = optics.fov;
    state.exposure = optics.exposure;
    state.playbackSpeed = shot.playbackSpeed;
    canvas.style.opacity = String(shot.opacity);
  } else {
    updateNavigation(dt);
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
  catch (error) {
    if (renderer.gl.isContextLost()) return;
    renderer.dispose(); showError(error); return;
  }
  if (!firstFrameReady || (state.introActive && (introPriming || introAtEndpoint))) renderer.finishFrame();
  if (!firstFrameReady) {
    firstFrameReady = true; startup.firstFrameReady = performance.now();
    if (startupLoader) startupLoader.hidden = true;
    lastFrame = performance.now();
  }
  if (state.introActive && introPriming) {
    introPriming = false;
    introElapsed = introClipStart; lastFrame = performance.now();
  }
  if (state.introActive && introAtEndpoint) {
    introFading = true; introFadeElapsed = 0;
    lastFrame = performance.now();
  }
  if (now - lastUI > 100) { ui.update(); lastUI = now; }
  frameID = requestAnimationFrame(frame);
}

const onContextLost = (event: Event) => {
  event.preventDefault();
  if (disposed || graphicsLost) return;
  graphicsLost = true; cancelAnimationFrame(frameID);
  resumeIntroAfterRecovery = state.introActive; recoveryHUD = state.hudActive;
  cachedField = renderer?.field ?? cachedField;
  gyroRequest++; gyro.disable(); state.gyroActive = false; state.gyroPending = false;
  state.gyroStatus = 'Gyro is off.';
  renderer?.dispose(); renderer = undefined; debug.renderer = undefined;
  state.playing = false; state.loading = true; state.flowAvailable = false;
  reseedAt = -1; firstFrameReady = false; startup.firstFrameReady = 0;
  if (graphicsRecoveries >= 2 || !cachedField) {
    showError(new Error('Graphics could not recover reliably. Reload the page to try again.'));
    return;
  }
  state.status = 'Restoring graphics…';
  if (startupStage) startupStage.textContent = state.status;
  if (startupLoader) startupLoader.hidden = false;
  ui.update();
};
const onContextRestored = () => {
  if (disposed || !graphicsLost || !cachedField || graphicsRecoveries >= 2) return;
  graphicsRecoveries++;
  try {
    renderer = new Renderer(canvas, state, cachedField); debug.renderer = renderer;
    graphicsLost = false; startup.rendererReady = performance.now();
    state.loading = false; state.flowAvailable = true; state.playing = false;
    gyro.recalibrate(); renderer.reseed();
    // Lost GPU particle buffers cannot retain their identities. Restart an
    // automatic clip cleanly; manual exploration keeps its pose, time and optics.
    if (resumeIntroAfterRecovery) { startIntro(); state.hudActive = recoveryHUD; }
    else { canvas.style.transition = 'none'; canvas.style.opacity = '1'; }
    state.status = 'Graphics restored. Gyro is off.';
    ui.update(); lastFrame = performance.now(); frameID = requestAnimationFrame(frame);
  } catch (error) {
    renderer?.dispose(); renderer = undefined; debug.renderer = undefined;
    showError(error);
  }
};
canvas.addEventListener('webglcontextlost', onContextLost);
canvas.addEventListener('webglcontextrestored', onContextRestored);
const onVisibility = () => { lastFrame = performance.now(); };
document.addEventListener('visibilitychange', onVisibility);
const onManualInput = (event: Event) => {
  if (state.introActive && event.target instanceof Element && event.target.closest('input, select')) stopIntro(event.type !== 'input');
};
function returnToAuto() {
  state.hudActive = false; state.touchSettings = false;
  if (!state.introActive && state.isCore) startIntro();
  else { navigation.resetIntroLook(); ui.update(); canvas.focus({ preventScroll: true }); }
}
let wasCaptured = false;
const onCaptureChange = () => {
  if (disposed || graphicsLost) return;
  const captured = document.pointerLockElement === canvas;
  // Native Escape may be consumed by the browser before our key handler.
  // Releasing capture must still return manual flight to the movie.
  if (wasCaptured && !captured) returnToAuto();
  wasCaptured = captured;
};
const onFullscreenChange = () => {
  if (!document.fullscreenElement && state.screensaver) { state.screensaver = false; ui.update(); }
};
const onIntroKey = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.code === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (state.screensaver) { stopScreensaver(); return; }
    if (state.pointerLocked || document.pointerLockElement === canvas) document.exitPointerLock();
    returnToAuto();
    return;
  }
  if (!state.introActive || event.code !== 'Space') return;
  if (!state.pointerLocked && event.target instanceof Element
      && event.target.closest('button, input, select, textarea, summary, a, [contenteditable="true"]')) return;
  event.preventDefault(); event.stopImmediatePropagation(); enterFlight();
};
document.addEventListener('pointerdown', onManualInput, true);
document.addEventListener('input', onManualInput, true);
document.addEventListener('keydown', onIntroKey, true);
document.addEventListener('pointerlockchange', onCaptureChange);
document.addEventListener('fullscreenchange', onFullscreenChange);
let suppressTouchClickUntil = 0;
const onScreensaverTap = (event: PointerEvent) => {
  if (state.touchControls && state.screensaver) {
    event.preventDefault(); suppressTouchClickUntil = performance.now() + 500; stopScreensaver();
  }
};
// The compatibility click from the exit tap must not hit the newly revealed
// look button beneath the same finger.
const onTouchClick = (event: MouseEvent) => {
  if (performance.now() < suppressTouchClickUntil) {
    suppressTouchClickUntil = 0; event.preventDefault(); event.stopImmediatePropagation();
  }
};
canvas.addEventListener('pointerup', onScreensaverTap);
document.addEventListener('click', onTouchClick, true);
void start();

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true; cancelAnimationFrame(frameID); renderer?.dispose(); navigation.dispose(); gyro.dispose(); ui.dispose();
  canvas.removeEventListener('webglcontextlost', onContextLost);
  canvas.removeEventListener('webglcontextrestored', onContextRestored); document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('pointerdown', onManualInput, true); document.removeEventListener('input', onManualInput, true);
  document.removeEventListener('keydown', onIntroKey, true);
  document.removeEventListener('pointerlockchange', onCaptureChange);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  canvas.removeEventListener('pointerup', onScreensaverTap);
  document.removeEventListener('click', onTouchClick, true);
});
