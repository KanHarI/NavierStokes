import { expect, test, type Page } from '@playwright/test';

async function loadObservatory(page: Page) {
  await page.goto('/?field=exterior&debug=1');
  await page.waitForFunction(() => {
    const app = (window as any).__observatory;
    return app && !app.state.loading;
  });
}

async function setRange(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function stateValue(page: Page, property: string) {
  return page.evaluate((key) => (window as any).__observatory.state[key], property);
}

test('loads the scientific preview and advances finite GPU particles without browser errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await loadObservatory(page);
  await expect.poll(() => stateValue(page, 'particleCount')).toBeGreaterThan(0);
  await expect.poll(() => stateValue(page, 'modelLabel')).toMatch(/exterior/i);
  await page.getByText('Time & transport', { exact: true }).click();
  await page.locator('#control-independentDust').check();
  await expect.poll(async () => {
    const audit = await page.evaluate(() => (window as any).__observatory.renderer.audit());
    return audit.finiteParticles;
  }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.renderer.audit().lightInput)).toBeGreaterThan(0);
  const audit = await page.evaluate(() => (window as any).__observatory.renderer.audit());
  expect(audit.glError).toBe(0);
  expect(Number.isFinite(audit.lightOutput)).toBe(true);
  expect(audit.lightOutput).toBeGreaterThan(0);
  expect(Math.abs(audit.lightOutput / audit.lightInput - 1)).toBeLessThan(.02);
  await page.screenshot({ path: testInfo.outputPath('observatory.png') });
  await testInfo.attach('gpu-audit', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('optics and density controls change independent state, and scale is multiplicative', async ({ page }) => {
  await loadObservatory(page);
  await setRange(page, '#control-exposure', 2);
  await setRange(page, '#control-density', 240);
  await setRange(page, '#control-scale', -1);
  await expect.poll(() => stateValue(page, 'exposure')).toBe(2);
  await expect.poll(() => stateValue(page, 'density')).toBe(240);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.ship.scale)).toBeCloseTo(0.5);
  const optics = await page.evaluate(() => {
    const state = (window as any).__observatory.state;
    return { near: state.near, far: state.far, focus: state.focus };
  });
  expect(optics).toEqual({ near: 1, far: 3, focus: 2 });
});

test('playback pauses the simulation clock and independent dust leaves that clock paused', async ({ page }) => {
  await loadObservatory(page);
  const start = await stateValue(page, 'time');
  await page.locator('#toggle-play').click();
  await expect.poll(() => stateValue(page, 'time')).toBeGreaterThan(start);
  await page.locator('#toggle-play').click();
  await expect.poll(() => stateValue(page, 'playing')).toBe(false);
  const paused = await stateValue(page, 'time');
  const particlesBefore = await page.evaluate(() => (window as any).__observatory.renderer.audit().particleSamples as number[]);
  await page.getByText('Time & transport', { exact: true }).click();
  await page.locator('#control-independentDust').check();
  await expect.poll(() => stateValue(page, 'independentDust')).toBe(true);
  // Wait on animation frames rather than elapsed sleeps: ensure the clock stays
  // frozen while the renderer continues producing frames in independent mode.
  await page.evaluate(() => new Promise<void>((resolve) => {
    let remaining = 8;
    const step = () => --remaining ? requestAnimationFrame(step) : resolve();
    requestAnimationFrame(step);
  }));
  expect(await stateValue(page, 'time')).toBe(paused);
  const particlesAfter = await page.evaluate(() => (window as any).__observatory.renderer.audit().particleSamples as number[]);
  const moved = particlesAfter.some((value, index) => index % 4 !== 3 && Math.abs(value - particlesBefore[index]) > 1e-6);
  expect(moved).toBe(true);
});

test('reports unsupported WebGL instead of leaving a blank or loading screen', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: any[]) {
      if (type === 'webgl2') return null;
      return (original as any).call(this, type, ...args);
    } as typeof original;
  });
  await page.goto('/?field=exterior&debug=1');
  await expect(page.getByRole('alert')).toHaveText(/WebGL\s*2.*(?:required|unavailable|support)/i);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('rejects a corrupted field chunk and disables playback', async ({ page }) => {
  await page.route('**/datasets/heat-exterior.json', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    // Same byte count: exercise the checksum rather than only a length check.
    const changed = body.replace(/"schemaVersion"\s*:\s*1/, (match) => match.replace('1', '2'));
    expect(changed).not.toBe(body);
    await route.fulfill({ response, body: changed });
  });
  await page.goto('/?field=exterior&debug=1');
  await expect(page.getByRole('alert')).toHaveText(/checksum.*(?:match|mismatch)/i);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#toggle-play')).toBeDisabled();
});

test('flight follows ship orientation, normalizes diagonals, and ignores editing keys', async ({ page }) => {
  await loadObservatory(page);
  const result = await page.evaluate(async () => {
    // Exercise the same DOM event handlers with a separate deterministic clock.
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState();
    state.ship.position = [0, 0, 0];
    state.ship.orientation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    state.pointerLocked = true;
    const navigation = createNavigation(document.createElement('canvas'), state);
    const key = (type: string, code: string, target: EventTarget = document) =>
      target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    try {
      key('keydown', 'KeyW');
      navigation.update(.1);
      key('keyup', 'KeyW');
      const forward = [...state.ship.position];
      state.ship.position = [0, 0, 0];
      key('keydown', 'KeyW');
      key('keydown', 'KeyD');
      navigation.update(.1);
      key('keyup', 'KeyW');
      key('keyup', 'KeyD');
      const diagonalLength = Math.hypot(...state.ship.position);
      state.ship.position = [0, 0, 0];
      const input = document.querySelector<HTMLInputElement>('#control-exposure')!;
      key('keydown', 'KeyW', input);
      navigation.update(.1);
      const editingDisplacement = Math.hypot(...state.ship.position);
      return { forward, diagonalLength, editingDisplacement };
    } finally {
      navigation.dispose();
    }
  });
  expect(result.forward[0]).toBeCloseTo(-.05, 8);
  expect(result.forward[1]).toBeCloseTo(0, 8);
  expect(result.forward[2]).toBeCloseTo(0, 8);
  expect(result.diagonalLength).toBeCloseTo(.05, 8);
  expect(result.editingDisplacement).toBe(0);
});

test('browser velocity reconstruction agrees with independent integral samples and rejects unsupported queries', async ({ page }) => {
  await loadObservatory(page);
  const report = await page.evaluate(async () => {
    const { loadField, sampleVelocity } = await import('/src/field.ts');
    const field = await loadField('exterior');
    const reference = await (await fetch('/datasets/velocity-reference.json')).json();
    let largestToleranceFraction = 0;
    let largestGPUToleranceFraction = 0;
    for (const sample of reference.samples) {
      const actual = sampleVelocity(field, sample.position, sample.time);
      if (!actual) throw new Error('Reference sample unexpectedly outside domain');
      const gpu = (window as any).__observatory.renderer.auditVelocity(sample.position, sample.time);
      if (!gpu.valid || gpu.glError) throw new Error(`GPU reference query failed: ${JSON.stringify({ sample, gpu })}`);
      for (let component = 0; component < 3; component++) {
        const expected = sample.velocity[component];
        const tolerance = reference.suggestedAbsoluteTolerance + Math.abs(expected) * reference.suggestedRelativeTolerance;
        largestToleranceFraction = Math.max(largestToleranceFraction, Math.abs(actual[component] - expected) / tolerance);
        largestGPUToleranceFraction = Math.max(largestGPUToleranceFraction, Math.abs(gpu.velocity[component] - expected) / tolerance);
      }
    }
    return {
      largestToleranceFraction,
      largestGPUToleranceFraction,
      invalidQueries: [
        sampleVelocity(field, [0, 0, 0], .5),
        sampleVelocity(field, [100, 0, 0], .5),
        sampleVelocity(field, [1, 0, 0], 1),
        sampleVelocity(field, [NaN, 0, 0], .5),
        sampleVelocity(field, [1, 0, 0], NaN),
        sampleVelocity(field, [.5 - 1e-12, 0, 0], .5),
        sampleVelocity(field, [8 + 1e-12, 0, 0], .5),
      ],
    };
  });
  expect(report.largestToleranceFraction).toBeLessThanOrEqual(1);
  expect(report.largestGPUToleranceFraction).toBeLessThanOrEqual(1);
  expect(report.invalidQueries).toEqual([null, null, null, null, null, null, null]);
});

test('GPU excess-light redistribution conserves luminance at edges and accounts for full-screen overload', async ({ page }, testInfo) => {
  await loadObservatory(page);
  const audit = await page.evaluate(() => (window as any).__observatory.renderer.auditLight());
  expect(audit.glError).toBe(0);
  expect(audit.cases).toHaveLength(4);
  for (const sample of audit.cases) {
    expect(Number.isFinite(sample.input), sample.name).toBe(true);
    expect(Number.isFinite(sample.output), sample.name).toBe(true);
    expect(sample.relativeError, sample.name).toBeLessThan(.01);
    expect(sample.overflow, sample.name).toBeGreaterThanOrEqual(0);
  }
  const overload = audit.cases.find((sample: { name: string }) => sample.name === 'full-screen');
  expect(overload.overflow / overload.input).toBeGreaterThan(.4);
  expect(overload.overflow / overload.input).toBeLessThan(.6);
  for (const sample of audit.cases.filter((item: { name: string }) => item.name !== 'full-screen')) {
    expect(sample.overflow / sample.input, sample.name).toBeLessThan(.2);
  }
  await testInfo.attach('synthetic-light-audit', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
});

test('Gaussian defocus preserves the integrated light of an individual particle', async ({ page }, testInfo) => {
  await loadObservatory(page);
  const audit = await page.evaluate(() => (window as any).__observatory.renderer.auditGaussian());
  expect(audit.glError).toBe(0);
  expect(audit.cases).toHaveLength(3);
  for (const sample of audit.cases) {
    expect(Number.isFinite(sample.light), `distance ${sample.distance}`).toBe(true);
    expect(Math.abs(sample.light / audit.expectedLight - 1), `distance ${sample.distance}`).toBeLessThan(.01);
  }
  console.info('Gaussian GPU audit:', JSON.stringify(audit));
  await testInfo.attach('gaussian-light-audit', { body: JSON.stringify(audit, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('gaussian-preview.png') });
});
