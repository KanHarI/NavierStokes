import { timelinePosition, timeAtPosition } from './time';
import type { Actions, AppState } from './types';

type Binding = { update(): void };
const formatScale = (value: number) => value < .01 || value >= 1000 ? value.toExponential(2) : value.toFixed(value < 1 ? 3 : 2);

export function createUI(container: HTMLElement, state: AppState, actions: Actions) {
  const root = document.createElement('div');
  root.className = 'cockpit';
  root.innerHTML = `
    <div id="viewer-controls">
    <header class="mission-header">
      <div>
        <div class="eyebrow"><span class="signal"></span> Fluid observatory / 001</div>
        <h1 class="wordmark">Navier–Stokes <span>/ explorer</span></h1>
        <span class="scope-badge" id="model-label"></span>
      </div>
      <nav class="header-actions" aria-label="Viewer tools">
        <button class="quiet-button" id="screensaver">Screensaver</button>
        <button class="quiet-button" id="replay-intro">Replay sequence</button>
        <select id="field-select" aria-label="Scientific field"><option value="extended">Core & surroundings</option><option value="core">Isolated core</option><option value="exterior">Heat exterior</option></select>
        <button class="quiet-button" id="toggle-help" aria-expanded="false" aria-controls="flight-help">Flight guide</button>
        <button class="quiet-button" id="toggle-controls" aria-expanded="true" aria-controls="flight-controls">Controls</button>
      </nav>
    </header>
    <aside class="control-panel" id="flight-controls" aria-label="Exploration controls">
      <div class="panel-top"><h2>Observation controls</h2><span>ESC to interact</span><button class="quiet-button touch-close" id="touch-close">Done</button></div>
      <details class="control-section" open><summary>Optics & light</summary><div class="section-content" id="optics-controls"></div></details>
      <details class="control-section"><summary>Ship & scale</summary><div class="section-content" id="ship-controls"></div></details>
      <details class="control-section"><summary>Dust & color</summary><div class="section-content" id="dust-controls"></div></details>
      <details class="control-section"><summary>Time & transport</summary><div class="section-content" id="time-controls"></div></details>
      <div class="panel-footer"><button class="quiet-button" id="reset-view">Reset view</button><button class="quiet-button" id="reseed-dust">New dust</button></div>
    </aside>
    <aside class="help-card" id="flight-help" hidden>
      <h2>Your ship is free of the flow.</h2>
      <dl class="key-list">
        <dt>Mouse</dt><dd>Look in any direction</dd>
        <dt>W A S D</dt><dd>Forward, back, sideways</dd>
        <dt>↑ / ↓</dt><dd>Local up / down</dd>
        <dt>Q / E</dt><dd>Roll left / right</dd>
        <dt>Z / X</dt><dd>Radar range nearer / farther</dd>
        <dt>Shift</dt><dd>Travel faster</dd>
        <dt>− / +</dt><dd>ISO / brightness down / up</dd>
        <dt>[ / ]</dt><dd>Field of view narrower / wider</dd>
        <dt>1 / 2</dt><dd>Shell depth narrower / wider</dd>
        <dt>3 / 4</dt><dd>Focus nearer / farther</dd>
        <dt>5 / 6</dt><dd>Gaussian bokeh less / more</dd>
        <dt>Space</dt><dd>Take control during a movie; otherwise play / pause</dd>
        <dt>Esc</dt><dd>Return to the automatic movie</dd>
      </dl>
      <p class="small-note">There is no fixed up. Scale changes your viewing distances and travel speed. Light is sharp at the focus shell and spreads softly on either side.</p>
      <p class="small-note scope-note" id="model-description"></p>
      <p class="small-note"><a href="https://github.com/KanHarI/NavierStokes" target="_blank" rel="noopener noreferrer">Source & scientific scope ↗</a></p>
    </aside>
    <div class="reticle" aria-hidden="true"></div>
    <div class="flight-prompt" id="flight-prompt"><button id="enter-flight">Click to fly <span aria-hidden="true">↗</span></button></div>
    <div class="intro-look-prompt" id="intro-look-prompt" hidden>
      <button id="explore-flow" class="explore-button">Click to look around <span aria-hidden="true">↗</span></button>
    </div>
    <section class="intro-card" id="intro-card" aria-label="A singularity, many perspectives: a sequence of changing views" hidden>
      <div class="intro-kicker">A singularity, many perspectives <span aria-hidden="true">/</span> <span id="intro-shot-number">01</span><span id="intro-duration">5.0 s clip</span></div>
      <h2 class="intro-title" id="intro-title">The gathering</h2>
      <p class="intro-description" id="intro-caption">A fluid accelerates. Space holds still.</p>
      <p class="intro-measures"><span>Linear time <span id="intro-time">0.0000</span></span><span>Core width <span id="intro-scale-ratio">1.00×</span></span><span>Axis speed <span id="intro-speed-ratio">1.0×</span></span></p>
      <div class="intro-progress" role="progressbar" aria-label="Current clip progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
    </section>
    <section class="flight-hud" id="flight-hud" aria-label="Flight instruments and keyboard controls" hidden>
      <div class="radar-steering-hint"><span class="radar-key">Z</span><span class="radar-key">X</span><span><strong>Explore the depth</strong><small>Radar nearer / farther · steer with the mouse</small></span></div>
      <div class="hud-instruments" tabindex="0" aria-label="All viewer instrument readings">
        <div class="hud-heading">RADAR RANGE <output id="hud-range"></output></div>
        <div class="hud-range-bar" aria-hidden="true"><span></span><i></i></div>
        <dl class="hud-gauges">
          <div><dt>Focus</dt><dd id="hud-focus"></dd></div>
          <div><dt>ISO</dt><dd id="hud-iso"></dd></div>
          <div><dt>View</dt><dd id="hud-fov"></dd></div>
          <div><dt>Time</dt><dd id="hud-time"></dd></div>
        </dl>
        <div id="hud-setting-groups"></div>
      </div>
      <div class="hud-controls">
        <div class="hud-control-heading">TRY THE CONTROLS <span id="hud-mode"></span></div>
        <dl class="hud-key-list">
          <div><dt>Mouse</dt><dd>Look</dd></div><div><dt>W A S D</dt><dd></dd></div>
          <div><dt>↑ / ↓</dt><dd>Up / down</dd></div><div><dt>Q / E</dt><dd>Roll</dd></div>
          <div><dt>Z / X</dt><dd>Radar range</dd></div><div><dt>Shift</dt><dd>Move faster</dd></div>
          <div><dt>− / +</dt><dd>Brightness</dd></div><div><dt>[ / ]</dt><dd>View width</dd></div>
          <div><dt>1 / 2</dt><dd>Shell thickness</dd></div><div><dt>3 / 4</dt><dd>Focus distance</dd></div>
          <div><dt>5 / 6</dt><dd>Bokeh</dd></div><div><dt>Space</dt><dd id="hud-space-action">Take control</dd></div>
          <div><dt>Esc</dt><dd>Return to auto</dd></div>
        </dl>
        <button id="take-control" class="quiet-button">Press Space to take control</button>
      </div>
    </section>
    <div class="touch-toolbar" hidden>
      <p class="touch-hint"><strong>Pinch to change radar distance</strong><span>Drag to look · or enable motion steering</span></p>
      <p class="touch-motion-status" id="touch-motion-status" role="status" hidden></p>
      <div class="touch-actions">
        <button class="quiet-button" id="touch-auto" aria-label="Return to auto">Auto</button>
        <button class="quiet-button" id="touch-manual">Take control</button>
        <button class="quiet-button" id="touch-gyro" aria-label="Motion steering" aria-pressed="false">Motion</button>
        <button class="quiet-button" id="touch-settings" aria-expanded="false" aria-controls="flight-controls">Settings</button>
      </div>
    </div>
    <section class="telemetry" aria-label="Live telemetry">
      <div><div class="instrument-label">Observation scale</div><div class="instrument-number"><span id="ship-scale">1.00</span><small>×</small></div></div>
      <div><div class="instrument-label">Local tracers</div><div class="instrument-number" id="particle-count">—</div></div>
      <div class="performance-instrument"><div class="instrument-label">Frame rate</div><div class="instrument-number"><span id="frame-rate">—</span><small>fps</small></div></div>
    </section>
    <footer class="timeline-bar">
      <button class="play-button" id="toggle-play" aria-label="Play simulation">▶</button>
      <div class="time-track">
        <label class="time-caption" for="simulation-time"><span id="clock-label">SIMULATION TIME</span><output id="time-output">0.000</output></label>
        <input id="simulation-time" type="range" min="0" max="1" step="0.0001" value="0" aria-label="Simulation time">
      </div>
      <div class="status-readout" id="viewer-status" role="status" aria-live="polite"></div>
    </footer>
    </div>
    <button class="quiet-button interface-toggle" id="toggle-interface" aria-expanded="true" aria-controls="viewer-controls">Hide controls</button>`;
  container.append(root);
  const bindings: Binding[] = [];
  const hudBindings: (() => void)[] = [];
  const listeners: (() => void)[] = [];
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const fieldSelect = find<HTMLSelectElement>('#field-select');
  fieldSelect.value = state.fieldKind;
  fieldSelect.addEventListener('change', () => {
    const url = new URL(location.href); url.searchParams.set('field', fieldSelect.value); location.assign(url);
  });

  const on = (element: HTMLElement, event: string, callback: EventListener) => {
    element.addEventListener(event, callback);
    listeners.push(() => element.removeEventListener(event, callback));
  };
  type Gauge = { key: string; label: string; read(): string; value?: () => number; min?: number; max?: number; wide?: boolean };
  function hudGroup(title: string, gauges: Gauge[]) {
    const section = document.createElement('section'); section.className = 'hud-group';
    const heading = document.createElement('h3'); heading.textContent = title;
    const readings = document.createElement('dl'); readings.className = 'hud-readouts';
    for (const gauge of gauges) {
      const row = document.createElement('div'); if (gauge.wide) row.className = 'hud-reading-wide';
      const label = document.createElement('dt'); label.textContent = gauge.label;
      const value = document.createElement('dd'); value.id = `hud-setting-${gauge.key}`;
      row.append(label, value);
      const meter = document.createElement('span'); meter.className = 'hud-meter'; meter.setAttribute('aria-hidden', 'true');
      if (gauge.value) row.append(meter);
      hudBindings.push(() => {
        value.textContent = gauge.read();
        if (gauge.value) meter.style.setProperty('--level', String(Math.max(0, Math.min(1,
          (gauge.value() - (gauge.min ?? 0)) / ((gauge.max ?? 1) - (gauge.min ?? 0))))));
      });
      readings.append(row);
    }
    section.append(heading, readings); find('#hud-setting-groups').append(section);
  }
  const scaleUnits = (value: number) => `${value.toFixed(2)}×`;
  hudGroup('Radar & light', [
    { key: 'near', label: 'Inner radius', read: () => scaleUnits(state.near), value: () => state.near, min: .05, max: 8 },
    { key: 'far', label: 'Outer radius', read: () => scaleUnits(state.far), value: () => state.far, min: .05, max: 8 },
    { key: 'focus', label: 'Focus / scale', read: () => scaleUnits(state.focus), value: () => state.focus, min: .1, max: 8 },
    { key: 'shellThickness', label: 'Shell thickness', read: () => scaleUnits(state.far - state.near), value: () => state.far - state.near, min: .05, max: 8 },
    { key: 'blur', label: 'Gaussian defocus', read: () => state.blur.toFixed(1), value: () => state.blur, max: 30 },
    { key: 'shellBokeh', label: 'Boundary bokeh', read: () => `${state.shellBokeh.toFixed(1)} px`, value: () => state.shellBokeh, max: 48 },
    { key: 'exposure', label: 'Exposure', read: () => `${state.exposure >= 0 ? '+' : ''}${state.exposure.toFixed(1)} EV`, value: () => state.exposure, min: -6, max: 8 },
  ]);
  hudGroup('Flight', [
    { key: 'movementSpeed', label: 'Travel / scales per s', read: () => (state.movementSpeed * (state.boosting ? 4 : 1)).toFixed(2) },
    { key: 'boost', label: 'Shift boost', read: () => state.boosting ? '4× active' : '1× normal' },
    { key: 'playing', label: 'Playback', read: () => state.playing ? 'Playing' : 'Paused' },
    { key: 'position', label: 'Position · x / y / z', read: () => state.ship.position.map(formatScale).join(' / '), wide: true },
    { key: 'orientation', label: 'Attitude · quaternion', read: () => state.ship.orientation.map(v => v.toFixed(2)).join(' / '), wide: true },
  ]);
  function slider(section: string, key: string, label: string, min: number, max: number, step: number,
    read: () => number, write: (value: number) => void, format: (value: number) => string,
    enabled: () => boolean = () => true) {
    const row = document.createElement('label');
    row.className = 'control-row';
    row.htmlFor = `control-${key}`;
    const caption = document.createElement('span');
    caption.className = 'control-caption';
    const text = document.createElement('span');
    text.textContent = label;
    const value = document.createElement('output');
    value.className = 'control-value';
    value.htmlFor = `control-${key}`;
    caption.append(text, value);
    const input = document.createElement('input');
    input.id = `control-${key}`;
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.setAttribute('aria-label', label);
    row.append(caption, input);
    find(section).append(row);
    on(input, 'input', () => {
      write(Number(input.value));
      // Keep the thumb at the accepted value when coupled bounds clamp the input.
      input.value = String(read());
    });
    bindings.push({ update() {
      if (document.activeElement !== input) input.value = String(read());
      value.textContent = format(read());
      input.setAttribute('aria-valuetext', value.textContent);
      input.disabled = !enabled();
    } });
  }
  function checkbox(section: string, key: string, label: string, read: () => boolean,
    write: (value: boolean) => void, enabled: () => boolean = () => true) {
    const row = document.createElement('label');
    row.className = 'check-row';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = `control-${key}`;
    const text = document.createElement('span'); text.textContent = label;
    row.append(input, text); find(section).append(row);
    on(input, 'change', () => write(input.checked));
    bindings.push({ update() { input.checked = read(); input.disabled = !enabled(); } });
  }
  function note(section: string, text: string) {
    const paragraph = document.createElement('p'); paragraph.className = 'small-note';
    paragraph.textContent = text; find(section).append(paragraph);
  }
  const optics = '#optics-controls';
  const ship = '#ship-controls';
  const dust = '#dust-controls';
  const time = '#time-controls';
  const multiple = (v: number) => `${v.toFixed(2)} × scale`;
  slider(optics, 'exposure', 'ISO / exposure', -6, 8, .1, () => state.exposure, v => { state.exposure = v; }, v => `ISO ${Math.round(100 * 2 ** v)} / ${v >= 0 ? '+' : ''}${v.toFixed(1)} EV`);
  slider(optics, 'focus', 'Focus distance', .1, 8, .05, () => state.focus, v => { state.focus = v; }, multiple);
  slider(optics, 'blur', 'Gaussian defocus', 0, 30, .25, () => state.blur, v => { state.blur = v; }, v => v.toFixed(1));
  slider(optics, 'fov', 'Horizontal field of view', 25, 120, 1, () => state.fov, v => { state.fov = v; }, v => `${v.toFixed(0)}°`);
  slider(optics, 'near', 'Shell inner radius', .05, 7.9, .05, () => state.near,
    v => { state.near = Math.min(v, state.far - .05); }, multiple);
  slider(optics, 'far', 'Shell outer radius', .15, 8, .05, () => state.far,
    v => { state.far = Math.max(v, state.near + .05); }, multiple);
  slider(optics, 'shellFade', 'Shell transition width', .05, 2, .05, () => state.shellFade, v => { state.shellFade = v; }, multiple);
  slider(optics, 'shellBokeh', 'Boundary bokeh', 0, 48, 1, () => state.shellBokeh, v => { state.shellBokeh = v; }, v => `${v.toFixed(0)} px`);
  note(optics, 'The spherical shell uses distance from your ship. Beyond either radius, dust spreads into bokeh and fades through the transition band before recycling.');
  slider(optics, 'renderScale', 'Render resolution', .5, 1.5, .1, () => state.renderScale,
    v => { state.renderScale = v; }, v => `${Math.round(v * 100)}%`);
  slider(ship, 'scale', 'Observation scale', -17, 14, .05, () => Math.log2(state.ship.scale),
    v => { state.ship.scale = 2 ** v; }, v => `${formatScale(2 ** v)} ×`);
  slider(ship, 'movementSpeed', 'Travel speed', .05, 3, .05, () => state.movementSpeed,
    v => { state.movementSpeed = v; }, v => `${v.toFixed(2)} scales / s`);
  note(ship, 'Scaling leaves your position fixed. Travel speed and shell distances follow the observation scale.');
  slider(dust, 'density', 'Particle density', 10, 2000, 10, () => state.density,
    v => { state.density = v; }, v => `${Math.round(v)} / scale³`);
  checkbox(dust, 'densityCompensation', 'Compensate brightness for density', () => state.densityCompensation,
    v => { state.densityCompensation = v; });
  const colorRow = document.createElement('label'); colorRow.className = 'select-row';
  colorRow.innerHTML = '<span>Particle color</span><select id="control-colorMode" aria-label="Particle color"><option value="white">White light</option><option value="speed">Speed · blue → red</option></select>';
  find(dust).append(colorRow);
  const colorSelect = colorRow.querySelector('select')!;
  on(colorSelect, 'change', () => { state.colorMode = colorSelect.value as AppState['colorMode']; });
  bindings.push({ update() { colorSelect.value = state.colorMode; } });
  checkbox(dust, 'distanceSaturation', 'Fade color with distance', () => state.distanceSaturation,
    v => { state.distanceSaturation = v; }, () => state.colorMode === 'speed');
  note(dust, 'Only nearby dust is simulated. Particles outside the observation buffer are recycled.');
  const hasFlow = () => state.flowAvailable && !state.loading;
  const timeModeRow = document.createElement('label'); timeModeRow.className = 'select-row';
  timeModeRow.innerHTML = '<span>Time progression</span><select id="control-timeMode" aria-label="Time progression"><option value="linear">Linear · real acceleration</option><option value="logarithmic">Logarithmic · slow approach</option></select>';
  find(time).append(timeModeRow);
  const timeModeSelect = timeModeRow.querySelector('select')!;
  on(timeModeSelect, 'change', () => {
    state.timeMode = timeModeSelect.value as typeof state.timeMode;
  });
  bindings.push({ update() { timeModeSelect.value = state.timeMode; } });
  slider(time, 'playbackSpeed', 'Time speed', -3, 1, .01, () => Math.log10(state.playbackSpeed),
    v => { state.playbackSpeed = 10 ** v; }, v => `${(10 ** v).toFixed(3)} ${state.timeMode === 'linear' ? '×' : 'decades / s'}`, hasFlow);
  note(time, 'Speed ranges from 0.001 to 10. In linear mode, 1× advances one simulation time unit per second.');
  checkbox(time, 'independentDust', 'Independent dust transport', () => state.independentDust,
    v => { state.independentDust = v; }, hasFlow);
  slider(time, 'dustSpeed', 'Independent dust speed', .001, 1, .001, () => state.dustSpeed,
    v => { state.dustSpeed = v; }, v => `${v.toFixed(3)} × velocity`, () => hasFlow() && state.independentDust);
  if (state.isCore) note(time, 'Linear time keeps a constant simulation rate as the core accelerates. Logarithmic time slows the approach for inspection. Reset view frames the core at the selected time; flight remains independent.');
  note(time, 'Independent mode moves dust even while time is paused. These paths differ from the physical time-dependent trajectories. Scrubbing reseeds the dust.');

  const panel = find('#flight-controls');
  const help = find('#flight-help');
  const controlsToggle = find<HTMLButtonElement>('#toggle-controls');
  const helpToggle = find<HTMLButtonElement>('#toggle-help');
  const prompt = find('#flight-prompt');
  const timeline = find<HTMLInputElement>('#simulation-time');
  const play = find<HTMLButtonElement>('#toggle-play');
  const status = find('#viewer-status');
  const introCard = find('#intro-card');
  const introTitle = find('#intro-title');
  const introNumber = find('#intro-shot-number');
  const introProgress = find('.intro-progress');
  const replayIntro = find<HTMLButtonElement>('#replay-intro');
  const viewerControls = find('#viewer-controls');
  const interfaceToggle = find<HTMLButtonElement>('#toggle-interface');
  on(interfaceToggle, 'click', () => {
    viewerControls.hidden = !viewerControls.hidden;
    interfaceToggle.textContent = `${viewerControls.hidden ? 'Show' : 'Hide'} ${state.hudActive ? 'HUD' : 'controls'}`;
    interfaceToggle.setAttribute('aria-expanded', String(!viewerControls.hidden));
    root.classList.toggle('is-interface-hidden', viewerControls.hidden);
  });
  on(controlsToggle, 'click', () => {
    const leavingIntro = root.classList.contains('is-intro');
    if (state.introActive) actions.stopIntro();
    panel.hidden = leavingIntro ? false : !panel.hidden;
    if (state.touchControls) { state.hudActive = true; state.touchSettings = true; panel.hidden = false; result.update(); }
    controlsToggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden && innerWidth < 760) { help.hidden = true; helpToggle.setAttribute('aria-expanded', 'false'); }
  });
  on(helpToggle, 'click', () => {
    help.hidden = !help.hidden;
    helpToggle.setAttribute('aria-expanded', String(!help.hidden));
    if (!help.hidden && innerWidth < 760) { panel.hidden = true; controlsToggle.setAttribute('aria-expanded', 'false'); }
  });
  on(find('#enter-flight'), 'click', () => actions.enterFlight());
  on(find('#explore-flow'), 'click', () => actions.lookAround());
  on(find('#take-control'), 'click', () => actions.enterFlight());
  on(replayIntro, 'click', () => actions.startIntro());
  on(find('#screensaver'), 'click', () => actions.startScreensaver());
  on(find('#touch-auto'), 'click', () => actions.returnToAuto());
  on(find('#touch-gyro'), 'click', () => actions.toggleGyro());
  on(find('#touch-manual'), 'click', () => {
    if (state.introActive) actions.enterFlight();
    else if (hasFlow()) state.playing = !state.playing;
    result.update();
  });
  on(find('#touch-settings'), 'click', () => {
    if (state.introActive) actions.stopIntro();
    state.touchSettings = !state.touchSettings; panel.hidden = false; result.update();
  });
  on(find('#touch-close'), 'click', () => { state.touchSettings = false; result.update(); });
  on(find('#reset-view'), 'click', () => actions.reset());
  on(find('#reseed-dust'), 'click', () => actions.reseed());
  on(play, 'click', () => { if (hasFlow()) state.playing = !state.playing; });
  on(timeline, 'input', () => actions.scrub(timeAtPosition(Number(timeline.value), state.timeMode)));

  let lastStatus = '';
  let lastTelemetry = 0;
  const result = {
    update() {
      for (const binding of bindings) binding.update();
      root.classList.toggle('is-captured', state.pointerLocked);
      root.classList.toggle('is-intro', state.introActive);
      root.classList.toggle('is-hud', state.hudActive);
      root.classList.toggle('is-screensaver', state.screensaver);
      root.classList.toggle('is-touch', state.touchControls);
      root.classList.toggle('is-touch-settings', state.touchControls && state.touchSettings);
      find('.touch-toolbar').hidden = !state.touchControls || !state.hudActive;
      find('#touch-manual').textContent = state.introActive ? 'Take control' : state.playing ? 'Pause' : 'Play';
      find('#touch-settings').setAttribute('aria-expanded', String(state.touchSettings));
      find('#touch-gyro').setAttribute('aria-pressed', String(state.gyroActive));
      find<HTMLButtonElement>('#touch-gyro').disabled = state.gyroPending;
      find('#touch-gyro').textContent = state.gyroPending ? 'Allow…' : state.gyroActive ? 'Motion on' : 'Motion';
      find('#touch-motion-status').textContent = state.gyroStatus;
      find('#touch-motion-status').hidden = !state.gyroStatus;
      find('#explore-flow').innerHTML = `${state.touchControls ? 'Tap to look around' : 'Click to look around'} <span aria-hidden="true">↗</span>`;
      find('#enter-flight').textContent = state.touchControls ? 'Touch to explore' : 'Click to fly ↗';
      find<HTMLButtonElement>('#screensaver').disabled = !hasFlow() || !state.isCore;
      introCard.hidden = !state.introActive;
      find('#intro-look-prompt').hidden = !state.introActive || state.hudActive || state.pointerLocked;
      find('#flight-hud').hidden = !state.hudActive;
      find('#take-control').hidden = !state.introActive;
      interfaceToggle.textContent = `${viewerControls.hidden ? 'Show' : 'Hide'} ${state.hudActive ? 'HUD' : 'controls'}`;
      if (state.hudActive) {
        for (const update of hudBindings) update();
        find('#hud-range').textContent = `${formatScale(state.near * state.ship.scale)}–${formatScale(state.far * state.ship.scale)}`;
        const bar = find('.hud-range-bar');
        bar.style.setProperty('--range-start', `${state.near / 8 * 100}%`);
        bar.style.setProperty('--range-width', `${(state.far - state.near) / 8 * 100}%`);
        bar.style.setProperty('--range-focus', `${Math.min(100, Math.max(0, state.focus / 8 * 100))}%`);
        find('#hud-focus').textContent = formatScale(state.focus * state.ship.scale);
        find('#hud-iso').textContent = Math.round(100 * 2 ** state.exposure).toLocaleString();
        find('#hud-fov').textContent = `${Math.round(state.fov)}°`;
        find('#hud-time').textContent = state.time.toFixed(4);
        find('#hud-mode').textContent = state.introActive ? 'Movie · resets each clip' : 'Manual flight';
        find('#hud-space-action').textContent = state.introActive ? 'Take control' : 'Play / pause';
      }
      replayIntro.hidden = state.introActive || !state.isCore;
      replayIntro.disabled = !hasFlow();
      controlsToggle.setAttribute('aria-expanded', String(!state.introActive && !panel.hidden));
      if (state.introActive) {
        introTitle.textContent = state.introTitle;
        find('#intro-caption').textContent = state.introCaption;
        find('#intro-scale-ratio').textContent = `${state.introScaleRatio.toFixed(2)}×`;
        find('#intro-speed-ratio').textContent = `${state.introSpeedRatio.toFixed(1)}×`;
        find('#intro-time').textContent = state.time.toFixed(4);
        introNumber.textContent = String(state.introShot + 1).padStart(2, '0');
        find('#intro-duration').textContent = `${state.introDuration.toFixed(1)} s clip`;
        const progress = Math.max(0, Math.min(1, state.introProgress));
        introProgress.style.setProperty('--shot-progress', String(progress));
        introProgress.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      }
      prompt.classList.toggle('is-flying', state.pointerLocked);
      find('#model-label').textContent = state.modelLabel;
      find('#model-description').textContent = state.modelDescription;
      timeline.min = String(timelinePosition(state.timeMin, state.timeMode));
      timeline.max = String(timelinePosition(state.timeMax, state.timeMode));
      timeline.step = 'any';
      if (document.activeElement !== timeline) timeline.value = String(timelinePosition(state.time, state.timeMode));
      timeline.disabled = !hasFlow();
      find('#time-output').textContent = state.isCore ? `t ${state.time.toFixed(6)} · remaining ${(1 - state.time).toExponential(2)}` : state.time.toFixed(4);
      find('#clock-label').textContent = `${state.timeMode === 'linear' ? 'LINEAR TIME' : 'LOGARITHMIC TIME'}${state.independentDust ? ' · INDEPENDENT DUST' : ''}`;
      timeline.setAttribute('aria-valuetext', `Time ${state.time.toFixed(6)}, remaining ${(1 - state.time).toExponential(2)}`);
      play.disabled = !hasFlow();
      play.textContent = state.playing ? 'Ⅱ' : '▶';
      play.setAttribute('aria-label', state.playing ? 'Pause simulation' : 'Play simulation');
      play.setAttribute('aria-pressed', String(state.playing));
      const message = state.overflow > .01 ? `${state.status} · Unresolved light: ${(state.overflow * 100).toFixed(1)}%` : state.status;
      if (message !== lastStatus) { status.textContent = message; lastStatus = message; }
      status.classList.toggle('is-warning', state.overflow > .01 || !state.flowAvailable);
      const now = performance.now();
      if (now - lastTelemetry > 200) {
        find('#ship-scale').textContent = formatScale(state.ship.scale);
        find('#particle-count').textContent = state.particleCount.toLocaleString();
        find('#frame-rate').textContent = state.fps ? Math.round(state.fps).toString() : '—';
        lastTelemetry = now;
      }
    },
    dispose() { for (const remove of listeners) remove(); root.remove(); },
  };
  result.update();
  return result;
}
