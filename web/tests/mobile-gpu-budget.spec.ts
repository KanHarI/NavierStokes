import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

test('bounded mobile GPU intervals preserve the complete desktop trajectory without an endpoint reseed', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.route('**/mobile-budget-host', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>canvas{display:inline-block;width:128px;height:128px}</style>
      <canvas id="mobile"></canvas><canvas id="desktop"></canvas>`,
  }));
  await page.goto('/mobile-budget-host');
  const report = await page.evaluate(async () => {
    const { loadField } = await import('/src/field.ts');
    const { initialState } = await import('/src/types.ts');
    const { Renderer } = await import('/src/renderer.ts');
    const { limitTransportFraction } = await import('/src/transport.ts');
    const field = await loadField('extended');
    const makeState = (touchControls: boolean) => {
      const state = initialState();
      Object.assign(state, { touchControls, introActive: false, density: 8,
        renderScale: 1, time: 0, timeMin: field.manifest.time.start,
        timeMax: field.manifest.time.end, loading: false, flowAvailable: true });
      return state;
    };
    const mobileState = makeState(true), desktopState = makeState(false);
    const mobile = new Renderer(document.querySelector<HTMLCanvasElement>('#mobile')!, mobileState, field);
    const desktop = new Renderer(document.querySelector<HTMLCanvasElement>('#desktop')!, desktopState, field);
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const complete = async (renderer: InstanceType<typeof Renderer>, wall: number, delta: number) => {
      const deadline = performance.now()+45_000;
      const first = renderer.render(wall, delta, delta);
      let result = first, calls = 1;
      while (result === false) {
        if (performance.now() > deadline) throw new Error('GPU transport failed to complete within 45 seconds: '+JSON.stringify({ calls, lost: renderer.gl.isContextLost(), audit: renderer.audit(0) }));
        await nextFrame(); result = renderer.render(wall, delta, delta); calls++;
      }
      renderer.finishFrame();
      return { first, calls, audit: renderer.audit(6000) };
    };
    try {
      await complete(mobile, 0, 0); await complete(desktop, 0, 0);
      const initialMobile = mobile.audit(6000), initialDesktop = desktop.audit(6000);
      const target = field.manifest.time.end;
      const intervals = [];
      let time = 0, transported = 0;
      let mobileResult, desktopResult;
      while (time < target) {
        if (intervals.length > 100) throw new Error('Bounded intervals did not reach the endpoint.');
        const remaining = target-time;
        const fraction = limitTransportFraction({ isCore: true, tauEnd: 1-target,
          timeDelta: remaining, transportDelta: remaining });
        const nextTime = fraction === 1 ? target : time+fraction*remaining;
        const delta = nextTime-time;
        mobileState.time = desktopState.time = nextTime;
        // Same physical intervals, immutable requests, seeds and particle IDs;
        // only GPU command scheduling differs between these renderers.
        mobileResult = await complete(mobile, .016, delta);
        desktopResult = await complete(desktop, .016, delta);
        const { particleSamples: actual, ...mobileAudit } = mobileResult.audit;
        const { particleSamples: reference, ...desktopAudit } = desktopResult.audit;
        const difference = Math.max(...actual.map((value: number, i: number) =>
          Math.abs(value-reference[i])/(1+Math.abs(reference[i]))));
        intervals.push({ time: nextTime, delta, difference,
          mobile: { ...mobileResult, audit: mobileAudit },
          desktop: { ...desktopResult, audit: desktopAudit } });
        transported += delta; time = nextTime;
      }
      return { target, time, transported, intervals, particles: mobileState.particleCount,
        initialMobile, initialDesktop, mobile: mobileResult!, desktop: desktopResult! };
    } finally { mobile.dispose(); desktop.dispose(); }
  });
  expect(report.particles).toBeGreaterThanOrEqual(4_000);
  expect(report.particles).toBeLessThanOrEqual(5_500);
  expect(report.initialMobile.particleSamples).toEqual(report.initialDesktop.particleSamples);
  expect(report.intervals.length).toBeGreaterThan(20);
  expect(report.time).toBe(report.target);
  expect(report.transported).toBeCloseTo(report.target, 13);
  expect(report.intervals.some(interval => interval.mobile.first === false)).toBe(true);
  for (const interval of report.intervals) {
    expect(interval.desktop.first).toBe(true);
    expect(interval.desktop.calls).toBe(1);
    const batching = interval.mobile.audit.batching;
    if (batching.deferred) {
      expect(interval.mobile.calls).toBeGreaterThan(1);
      expect(batching.batches).toBeGreaterThan(1);
      expect(batching.completedBatches).toBe(batching.batches);
      expect(batching.completedParticles).toBe(report.particles);
      expect(batching.completedParticleSteps).toBe(report.particles*interval.mobile.audit.transport!.steps);
    }
    expect(batching.maxBatchIterations).toBeLessThanOrEqual(500_000);
    expect(batching.pending).toBe(false); expect(batching.canceled).toBe(false);
    for (const result of [interval.mobile, interval.desktop]) {
      expect(result.audit.glError).toBe(0);
      expect(result.audit.finiteParticles).toBe(true);
      expect(result.audit.transport!.steps).toBeLessThanOrEqual(128);
      expect(result.audit.transport!.reseed).toBe(false);
      expect(result.audit.transport!.reseeded).toBe(false);
      expect(result.audit.transport!.limited).toBe(false);
      expect(result.audit.transport!.actualDelta).toBe(interval.delta);
      expect(result.audit.transport!.timeDelta).toBe(interval.delta);
    }
    expect(interval.difference).toBeLessThan(2e-5);
  }
  const reference = report.desktop.audit.particleSamples;
  const actual = report.mobile.audit.particleSamples;
  expect(actual.length).toBe(reference.length);
  let moved = 0, largestNormalizedDifference = 0;
  for (let i = 0; i < actual.length; i++) {
    const difference = Math.abs(actual[i]-reference[i])/(1+Math.abs(reference[i]));
    largestNormalizedDifference = Math.max(largestNormalizedDifference, difference);
    if (i%4 !== 3 && Math.abs(reference[i]-report.initialDesktop.particleSamples[i]) > 1e-5) moved++;
  }
  expect(moved).toBeGreaterThan(10);
  expect(largestNormalizedDifference).toBeLessThan(2e-5);
  await info.attach('mobile-batch-equivalence', {
    body: JSON.stringify({ ...report, largestNormalizedDifference, moved }, null, 2), contentType: 'application/json',
  });
});

test('the mobile movie completes two clips while camera and field time stay fixed during GPU batches', async ({ page }, info) => {
  test.setTimeout(75_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const randomValues = crypto.getRandomValues.bind(crypto);
    // This real generated sequence has two short clips (5.49 s and 5.81 s).
    // Fix only the director seed, never its clock, fields or particle motion.
    crypto.getRandomValues = (value => {
      if (value instanceof Uint32Array && value.length === 1) { value[0] = 1401; return value; }
      return randomValues(value);
    }) as typeof crypto.getRandomValues;
  });
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as any).__observatory?.startup.firstFrameReady > 0);
  await page.evaluate(() => {
    const app = (window as any).__observatory, render = app.renderer.render.bind(app.renderer);
    const report = { pendingCalls: 0, stable: true, completed: [] as any[] };
    (window as any).__mobileBatchMovie = report;
    let held: string | null = null;
    app.renderer.render = (...args: any[]) => {
      const s = app.state;
      s.density = 8; s.renderScale = .5;
      const snapshot = JSON.stringify({ time: s.time, shot: s.introShot,
        position: s.ship.position, orientation: s.ship.orientation, scale: s.ship.scale,
        near: s.near, far: s.far, focus: s.focus, fov: s.fov });
      if (held !== null && held !== snapshot) report.stable = false;
      const result = render(...args);
      if (result === false) { report.pendingCalls++; held ??= snapshot; }
      else {
        held = null;
        if (s.time === s.timeMax) report.completed.push({ shot: s.introShot,
          time: s.time, audit: app.renderer.audit() });
      }
      return result;
    };
  });
  await page.waitForFunction(() => (window as any).__observatory.state.introShot >= 2, null, { timeout: 60_000 });
  const report = await page.evaluate(() => (window as any).__mobileBatchMovie);
  expect(report.pendingCalls).toBeGreaterThan(0);
  expect(report.stable).toBe(true);
  expect(report.completed.map((frame: any) => frame.shot)).toEqual([0, 1]);
  for (const frame of report.completed) {
    expect(frame.time).toBe(.9999);
    expect(frame.audit.glError).toBe(0);
    expect(frame.audit.finiteParticles).toBe(true);
    expect(frame.audit.transport.reseed).toBe(false);
    expect(frame.audit.batching.maxBatchIterations).toBeLessThanOrEqual(500_000);
  }
  await info.attach('mobile-movie-batches', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('a GPU fence that never signals offers reload instead of freezing the movie indefinitely', async ({ page }) => {
  await page.goto('/?debug=1&intro=0');
  await page.waitForFunction(() => (window as any).__observatory?.startup.firstFrameReady > 0);
  await page.clock.install();
  await page.evaluate(() => {
    const app = (window as any).__observatory;
    app.renderer.gl.clientWaitSync = () => app.renderer.gl.TIMEOUT_EXPIRED;
    Object.assign(app.state, { time: .98, playing: true, playbackSpeed: 1 });
  });
  await page.waitForFunction(() => (window as any).__observatory.renderer.hasPendingFrame);
  await page.clock.fastForward(8_100);
  await expect(page.getByRole('alert')).toContainText('The graphics update stalled');
  await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeVisible();
  await expect(page.locator('#startup-loader')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__observatory.state.flowAvailable)).toBe(false);
});
