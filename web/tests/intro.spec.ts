import { expect, test, type Page } from '@playwright/test';

const pointerLockMode = process.platform === 'darwin'
  ? 'macOS pointer-lock event contract; native permission untested'
  : 'native pointer lock';

/**
 * Chromium driven by Playwright on this macOS runner rejects pointer capture
 * with WrongDocumentError even for a minimal standalone page. Upstream report:
 * https://github.com/microsoft/playwright/issues/20956
 *
 * Adapt only the browser capture boundary on macOS. Application keyboard and
 * mouse handlers, navigation, UI, scientific time, rendering and clip resets
 * remain real. This validates their event contract, not native permission or
 * native Escape consumption. Other platforms exercise the native browser API.
 */
async function preparePointerLockContract(page: Page) {
  if (process.platform !== 'darwin') return;
  test.info().annotations.push({ type: 'platform limitation', description:
    'macOS Chromium pointer-lock API replaced by an asynchronous event adapter; native permission is untested. https://github.com/microsoft/playwright/issues/20956' });
  await page.addInitScript(() => {
    let captured: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true,
      get: () => captured });
    HTMLElement.prototype.requestPointerLock = function () {
      captured = this;
      queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
      return Promise.resolve();
    };
    document.exitPointerLock = () => {
      if (!captured) return;
      captured = null;
      queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
    };
  });
}

async function load(page: Page, query = '?debug=1') {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => {
    const app = (window as any).__observatory;
    return app && !app.state.loading && app.renderer && app.startup.firstFrameReady > 0;
  });
  await expect(page.locator('#startup-loader')).toBeHidden();
  const startup = await page.evaluate(() => (window as any).__observatory.startup);
  expect(startup.firstFrameReady).toBeGreaterThanOrEqual(startup.rendererReady);
  expect(startup.rendererReady).toBeGreaterThanOrEqual(startup.dataReady);
  // Keep the real clock and choreography intact while reducing software-GPU
  // work. These are ordinary quality controls, not a replacement frame clock.
  await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.density = 12;
    s.renderScale = .5;
  });
}

async function replay(page: Page) {
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await page.waitForFunction(() => !(window as any).__observatory.state.pointerLocked && !document.pointerLockElement);
  await page.getByRole('button', { name: /replay sequence/i }).click();
  await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.density = 12;
    s.renderScale = .5;
  });
}

test(`the arriving viewer plays a complete generated clip and starts a fresh one in real time (${pointerLockMode})`, async ({ page }, info) => {
  test.setTimeout(75_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await preparePointerLockContract(page);
  await load(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  const lookButton = page.locator('#explore-flow');
  const lookBounds = await lookButton.boundingBox();
  expect(lookBounds).toBeTruthy();
  await lookButton.click();
  await page.waitForFunction(() => (window as any).__observatory.state.pointerLocked && document.pointerLockElement?.id === 'space');
  const lookStart = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return { time: s.time, position: [...s.ship.position] };
  });
  await page.mouse.move(lookBounds!.x+lookBounds!.width/2+14, lookBounds!.y+lookBounds!.height/2+6, { steps: 2 });
  await page.evaluate(() => {
    const app = (window as any).__observatory, renderer = app.renderer;
    const audit = { start: performance.now(), startPhase: app.state.introProgress,
      observations: [] as any[], renderCount: 0,
      injectedStall: false, endpointRenderReturnedAt: 0, endpointFinishedAt: 0,
      endpointSnapshot: null as any };
    (window as any).__introAudit = audit;
    const render = renderer.render.bind(renderer), finish = renderer.finishFrame.bind(renderer);
    renderer.render = (...args: any[]) => {
      audit.renderCount++;
      render(...args);
      if (!audit.injectedStall && app.state.introShot === 0 && app.state.time === app.state.timeMax) {
        // Reproduce a slow final GPU frame without modifying physical time or
        // the director. Its completion must precede the presentation fade.
        audit.injectedStall = true;
        const until = performance.now()+450;
        while (performance.now() < until) { /* bounded endpoint stall */ }
        audit.endpointRenderReturnedAt = performance.now();
      }
    };
    renderer.finishFrame = () => {
      finish();
      if (audit.injectedStall && app.state.introShot === 0 && app.state.time === app.state.timeMax) {
        audit.endpointFinishedAt = performance.now();
        const s = app.state;
        audit.endpointSnapshot = { shot: s.introShot, duration: s.introDuration, phase: s.introProgress,
          time: s.time, minimum: s.timeMin, maximum: s.timeMax, active: s.introActive,
          title: s.introTitle, position: [...s.ship.position], orientation: [...s.ship.orientation],
          scale: s.ship.scale, color: s.colorMode, locked: s.pointerLocked, audit: renderer.audit() };
      }
    };
    let lastSample = -Infinity, previousShot = -1;
    const record = () => {
      const s = (window as any).__observatory.state, elapsed = performance.now()-audit.start;
      // Each generated clip chooses its own density. Keep only test rendering
      // quality reduced, including after its genuine per-clip reset.
      s.density = 12;
      const opacity = Number(document.querySelector<HTMLCanvasElement>('#space')!.style.opacity);
      if (s.introShot !== previousShot || elapsed-lastSample >= 100 || opacity === 0 || s.time === s.timeMax) {
        audit.observations.push({ elapsed, shot: s.introShot, duration: s.introDuration,
          active: s.introActive, phase: s.introProgress, time: s.time, color: s.colorMode,
          playing: s.playing, opacity, renderCount: audit.renderCount,
          view: JSON.stringify({ position: s.ship.position, orientation: s.ship.orientation,
            scale: s.ship.scale, near: s.near, far: s.far, focus: s.focus,
            fov: s.fov, exposure: s.exposure, blur: s.blur, bokeh: s.shellBokeh }) });
        lastSample = elapsed; previousShot = s.introShot;
      }
      if (elapsed < 45_000 && s.introActive) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  const capture = async (name: string, endpoint = false) => {
    const result = await page.evaluate(endpoint => {
      if (endpoint) return (window as any).__introAudit.endpointSnapshot;
      const app = (window as any).__observatory, s = app.state;
      return { shot: s.introShot, duration: s.introDuration, phase: s.introProgress,
        time: s.time, minimum: s.timeMin, maximum: s.timeMax, active: s.introActive,
        title: s.introTitle, position: s.ship.position, orientation: s.ship.orientation,
        scale: s.ship.scale, color: s.colorMode, locked: s.pointerLocked, audit: app.renderer.audit() };
    }, endpoint);
    expect(result.active).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(5);
    expect(result.duration).toBeLessThanOrEqual(30);
    expect(result.time).toBeGreaterThanOrEqual(result.minimum);
    expect(result.time).toBeLessThanOrEqual(result.maximum);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.scale).toBeGreaterThan(0);
    expect([...result.position, ...result.orientation, result.scale].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...result.orientation)).toBeCloseTo(1, 5);
    expect(result.color).toBe('white');
    expect(result.locked).toBe(true);
    expect(result.audit.finiteParticles).toBe(true);
    expect(result.audit.glError).toBe(0);
    expect(Number.isFinite(result.audit.lightInput)).toBe(true);
    expect(Number.isFinite(result.audit.lightOutput)).toBe(true);
    if (!endpoint) await page.screenshot({ path: info.outputPath(`${name}.png`) });
    return result;
  };
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.introShot === 0 && s.introProgress >= .3;
  }, null, { timeout: 35_000 });
  const first = await capture('intro-first-clip');
  // Leave the browser undisturbed through the endpoint and fade. An explicit
  // screenshot took 410 ms on this software-GPU runner, longer than the whole
  // 350 ms fade, and its compositor work prevented intermediate RAF samples.
  // The in-page finish hook retains endpoint data before the fade starts.
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.introShot === 1 && s.introProgress >= .12;
  }, null, { timeout: 35_000 });
  // Light telemetry is sampled every 1.5 s. At this point its cached value can
  // still belong to the new clip's black seed frame, despite a bright image.
  // Require a measurement taken after the visible part of this clip started;
  // wait on freshness only, then independently assert positive measured light.
  const nextVisibleAt = await page.evaluate(() => performance.now());
  await page.waitForFunction(after => {
    const app = (window as any).__observatory;
    return app.state.introShot === 1 && app.renderer.audit().lightMeasuredAt > after;
  }, nextVisibleAt, { polling: 100, timeout: 10_000 });
  const endpoint = await capture('intro-first-endpoint', true);
  const next = await capture('intro-next-clip');
  expect(first.shot).toBe(0); expect(endpoint.shot).toBe(0); expect(next.shot).toBe(1);
  expect(first.time).toBeGreaterThan(lookStart.time);
  expect(first.position).not.toEqual(lookStart.position);
  const alignment = (view: typeof first) => {
    const [x,y,z,w] = view.orientation, distance = Math.hypot(...view.position);
    const forward = [-2*(x*z+w*y), 2*(w*x-y*z), 2*(x*x+y*y)-1];
    return forward.reduce((sum,value,i) => sum-value*view.position[i]/distance, 0);
  };
  expect(alignment(first)).toBeLessThan(.99999);
  // Every new clip has its own framing: a prior user's look offset resets.
  expect(alignment(next)).toBeCloseTo(1, 8);
  expect(first.audit.lightInput).toBeGreaterThan(0);
  expect(next.audit.lightMeasuredAt).toBeGreaterThan(nextVisibleAt);
  expect(next.audit.lightInput).toBeGreaterThan(0);
  const report = await page.evaluate(() => (window as any).__introAudit);
  expect(report.injectedStall).toBe(true);
  expect(report.endpointFinishedAt).toBeGreaterThanOrEqual(report.endpointRenderReturnedAt);
  const ending = report.observations.filter((value: any) => value.shot === 0 && value.time === endpoint.maximum);
  expect(ending.length).toBeGreaterThan(2);
  expect(ending.every((value: any) => !value.playing)).toBe(true);
  expect(new Set(ending.map((value: any) => value.renderCount)).size).toBe(1);
  expect(new Set(ending.map((value: any) => value.view)).size).toBe(1);
  const firstBlack = ending.find((value: any) => value.opacity === 0);
  expect(firstBlack).toBeTruthy();
  expect(firstBlack.elapsed+report.start-report.endpointFinishedAt).toBeGreaterThanOrEqual(300);
  expect(ending.some((value: any) => value.opacity > .1 && value.opacity < .9)).toBe(true);
  const transition = report.observations.find((value: any) => value.shot === 1);
  expect(transition.elapsed).toBeGreaterThanOrEqual(Math.max(0, first.duration*(1-report.startPhase)-.35)*1000);
  expect(transition.elapsed).toBeGreaterThan(firstBlack.elapsed);
  expect(transition.phase).toBeLessThanOrEqual(.05);
  expect(report.observations.every((value: any) => value.active && value.color === 'white')).toBe(true);
  await info.attach('generated-intro-audit', { body: JSON.stringify({ ...report, captures: [first, endpoint, next] }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

async function moduleHost(page: Page) {
  await page.route('**/intro-module-host', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Procedural intro contract</title>',
  }));
  await page.goto('/intro-module-host');
}

test('generated clips are seeded, diverse, and optically well formed', async ({ page }) => {
  await moduleHost(page);
  const report = await page.evaluate(async () => {
    const { generateIntroClip, createIntroDirector } = await import('/src/intro.ts');
    return [1, 7, 29, 1234, 65535, 0x12345678, 0xabcdef01, 0xffffffff].map(seed => {
      const first = createIntroDirector(seed), second = createIntroDirector(seed);
      let start = 0;
      const clips = Array.from({ length: 16 }, (_, index) => {
        const config = generateIntroClip(seed, index), repeated = generateIntroClip(seed, index);
        const elapsed = start + .5*config.duration;
        const sample = first.sample(elapsed), duplicate = second.sample(elapsed);
        start += config.duration;
        return { config, repeated, sample, duplicate };
      });
      return { seed, clips };
    });
  });
  const samples = report.flatMap(group => group.clips);
  expect(new Set(samples.map(value => value.config.duration.toFixed(6))).size).toBeGreaterThan(80);
  expect(new Set(samples.map(value => value.sample.fov.toFixed(5))).size).toBeGreaterThan(80);
  expect(new Set(samples.map(value => value.sample.position.map((x: number) => x.toFixed(5)).join(','))).size).toBeGreaterThan(100);
  for (const { config, repeated, sample, duplicate } of samples) {
    expect(config).toEqual(repeated); expect(sample).toEqual(duplicate);
    expect(config.duration).toBeGreaterThanOrEqual(5); expect(config.duration).toBeLessThanOrEqual(30);
    expect(sample.shot).toBe(config.index);
    expect(sample.duration).toBe(config.duration);
    expect(sample.near).toBeGreaterThanOrEqual(0);
    expect(sample.focus).toBeGreaterThan(sample.near);
    expect(sample.focus).toBeLessThan(sample.far);
    expect(sample.shellFade).toBeGreaterThan(0);
    expect(sample.blur).toBeGreaterThanOrEqual(0); expect(sample.shellBokeh).toBeGreaterThanOrEqual(0);
    expect(sample.fov).toBeGreaterThan(10); expect(sample.fov).toBeLessThan(120);
    expect(sample.scale).toBeGreaterThan(0); expect(sample.perspective).toBeGreaterThan(0);
    expect([...sample.position, ...sample.orientation, sample.scale, sample.exposure, sample.perspective].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...sample.orientation)).toBeCloseTo(1, 10);
    const [x, y, z, w] = sample.orientation;
    const forward = [-2*(x*z+w*y), 2*(w*x-y*z), 2*(x*x+y*y)-1];
    const distance = Math.hypot(...sample.position);
    const alignment = forward.reduce((sum, value, i) => sum-value*sample.position[i]/distance, 0);
    expect(alignment).toBeCloseTo(1, 10);
    // The focused origin and shell share the same perspective-distance change.
    expect(distance/sample.scale).toBeCloseTo(sample.focus, 9);
  }
});

test('first and later clips independently mix uniform physical time and logarithmic remaining time', async ({ page }) => {
  await moduleHost(page);
  const report = await page.evaluate(async () => {
    const { generateIntroClip, sampleIntroClip } = await import('/src/intro.ts');
    return [0, 7].map(index => {
      const uniform: number[] = [], logarithmic: number[] = [];
      let minimum = Infinity, shortest = Infinity;
      for (let seed = 0; seed < 2000; seed++) {
        const config = generateIntroClip(seed, index), sample = sampleIntroClip(config, 0);
        minimum = Math.min(minimum, sample.startTime);
        shortest = Math.min(shortest, .9999 - sample.startTime);
        if (config.startDistribution === 'uniform') uniform.push(sample.startTime / .9998);
        else logarithmic.push(-Math.log10(1 - sample.startTime) / 3);
      }
      const summary = (values: number[]) => ({ count: values.length,
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        bins: Array.from({ length: 10 }, (_, bin) => values.filter(value => Math.floor(value * 10) === bin).length),
      });
      return { index, minimum, shortest, uniform: summary(uniform), logarithmic: summary(logarithmic) };
    });
  });
  for (const clips of report) {
    expect(clips.minimum).toBeGreaterThan(0);
    expect(clips.shortest).toBeGreaterThanOrEqual(.0001 - 1e-12);
    for (const distribution of [clips.uniform, clips.logarithmic]) {
      expect(distribution.count).toBeGreaterThan(850);
      expect(distribution.count).toBeLessThan(1150);
      expect(Math.abs(distribution.mean - .5)).toBeLessThan(.035);
      for (const count of distribution.bins) {
        expect(count).toBeGreaterThan(distribution.count * .055);
        expect(count).toBeLessThan(distribution.count * .145);
      }
    }
  }
});

test('every generated clip advances physical time linearly and resets only at black', async ({ page }) => {
  await moduleHost(page);
  const report = await page.evaluate(async () => {
    const { generateIntroClip, createIntroDirector } = await import('/src/intro.ts');
    return [19, 73, 2026].flatMap(seed => {
      const director = createIntroDirector(seed);
      let start = 0;
      return Array.from({ length: 12 }, (_, index) => {
        const config = generateIntroClip(seed, index), duration = config.duration, play = duration-.7;
        const at = (local: number) => director.sample(start+local, .2, .9999);
        const result = { index, duration, begin: at(1e-9),
          first: at(.35+.25*play), middle: at(.35+.5*play), last: at(.35+.75*play),
          endpoint: at(duration-.35+1e-9), fading: at(duration-.15), beforeNext: at(duration-1e-6), next: at(duration+1e-9) };
        start += duration;
        return result;
      });
    });
  });
  for (const clip of report) {
    const { begin, first, middle, last, endpoint, fading, beforeNext, next } = clip;
    expect(begin.shot).toBe(clip.index);
    expect(begin.startTime).toBeGreaterThan(.2);
    expect(begin.startTime).toBeLessThan(.9999);
    expect(begin.time).toBeCloseTo(begin.startTime, 10);
    expect(first.time).toBeGreaterThan(begin.startTime);
    expect(last.time-middle.time).toBeCloseTo(middle.time-first.time, 10);
    expect((last.time-first.time)/(.5*(clip.duration-.7))).toBeCloseTo(middle.playbackSpeed, 10);
    expect(endpoint.time).toBe(.9999); expect(beforeNext.time).toBe(.9999);
    for (const property of ['position', 'orientation', 'scale', 'perspective', 'fov', 'exposure',
      'near', 'far', 'focus', 'shellFade', 'blur', 'shellBokeh'] as const) {
      expect(fading[property]).toEqual(endpoint[property]);
      expect(beforeNext[property]).toEqual(endpoint[property]);
    }
    expect(begin.opacity).toBeLessThan(1e-6); expect(beforeNext.opacity).toBeLessThan(1e-6);
    expect(middle.opacity).toBe(1); expect(next.opacity).toBeLessThan(1e-6);
    expect(next.shot).toBe(clip.index+1);
    expect(next.time).toBeCloseTo(next.startTime, 10);
  }
});

test('manual input preserves the current view, and exploration and replay remain available', async ({ page }) => {
  await load(page);
  const preserved = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    const snapshot = () => ({ time: s.time, position: [...s.ship.position], orientation: [...s.ship.orientation], scale: s.ship.scale });
    const before = snapshot();
    document.querySelector<HTMLButtonElement>('#toggle-controls')!.click();
    return { before, after: snapshot(), active: s.introActive };
  });
  expect(preserved.active).toBe(false);
  expect(preserved.after).toEqual(preserved.before);
  await replay(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.locator('#toggle-controls').click();
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  await replay(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.locator('#control-fov').evaluate(element => {
    const input = element as HTMLInputElement;
    input.value = '80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  expect(await page.evaluate(() => (window as any).__observatory.state.fov)).toBe(80);
  await replay(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.locator('#toggle-controls').click();
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
});

test(`movie flight and radar range remain interactive; Space takes control and Escape resumes the movie (${pointerLockMode})`, async ({ page }) => {
  await preparePointerLockContract(page);
  await load(page);
  await page.locator('#explore-flow').click();
  await page.waitForFunction(() => (window as any).__observatory.state.pointerLocked && !!document.pointerLockElement);
  expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  const moving = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    const snapshot = () => ({ time: s.time, position: [...s.ship.position], orientation: [...s.ship.orientation], scale: s.ship.scale, far: s.far });
    const before = snapshot();
    // Hold translation, roll and radar enlargement while the scientific clip runs.
    // The genuine keyboard events below are observed over animation frames.
    return before;
  });
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyQ');
  await page.keyboard.down('KeyX');
  await page.waitForFunction(before => {
    const s = (window as any).__observatory.state;
    const [x,y,z,w] = s.ship.orientation, distance = Math.hypot(...s.ship.position);
    const forward = [-2*(x*z+w*y), 2*(w*x-y*z), 2*(x*x+y*y)-1];
    const alignment = forward.reduce((sum,value,i) => sum-value*s.ship.position[i]/distance, 0);
    // The automatic camera always aims at the origin. Lateral flight changes
    // that alignment; X enlarges radar distances without enlarging the ship.
    return s.time > before.time && s.far > before.far*1.05 && alignment < .99999;
  }, moving);
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyQ'); await page.keyboard.up('KeyX');
  expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  expect(await page.evaluate(() => (window as any).__observatory.state.ship.scale)).toBeLessThanOrEqual(moving.scale);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  expect(await page.evaluate(() => (window as any).__observatory.state.pointerLocked)).toBe(true);
  const before = await page.evaluate(() => [...(window as any).__observatory.state.ship.position]);
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(previous => {
    const p = (window as any).__observatory.state.ship.position;
    return Math.hypot(...p.map((value: number, i: number) => value-previous[i]));
  }, before)).toBeGreaterThan(0);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(window as any).__observatory.state.pointerLocked && !document.pointerLockElement);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  expect(await page.evaluate(() => (window as any).__observatory.state.pointerLocked)).toBe(false);
  expect(await page.evaluate(() => (window as any).__observatory.state.hudActive)).toBe(false);
});

test('reduced motion and explicit manual URLs do not autoplay the camera', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page);
  expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const query of ['?debug=1&intro=0', '?debug=1&field=core', '?debug=1&field=exterior']) {
    await load(page, query);
    expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  }
});

test('directional exposure preserves integrated particle light', async ({ page }) => {
  await load(page, '?field=exterior&debug=1');
  const report = await page.evaluate(() => {
    const r = (window as any).__observatory.renderer;
    return [r.auditGaussian(0), r.auditGaussian(.5)];
  });
  for (const audit of report) {
    expect(audit.glError).toBe(0);
    for (const sample of audit.cases) expect(Math.abs(sample.light/audit.expectedLight-1)).toBeLessThan(.02);
  }
});
