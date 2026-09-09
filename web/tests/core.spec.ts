import { expect, test, type Page } from '@playwright/test';

async function loadCore(page: Page) {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => {
    const app = (window as any).__observatory;
    return app && !app.state.loading && app.renderer;
  });
}

test('default view renders the local contracting core with finite light and particles', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loadCore(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.modelLabel)).toMatch(/local core/i);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.renderer.audit().lightInput)).toBeGreaterThan(0);
  const report = await page.evaluate(() => {
    const app = (window as any).__observatory;
    return { audit: app.renderer.audit(), description: app.state.modelDescription,
      manifest: app.renderer.field.manifest.status, color: app.state.colorMode };
  });
  expect(report.manifest).toBe('local-core-checkpoint');
  expect(report.description).toMatch(/(?:unmatched|not.*(?:full|complete)|local)/i);
  expect(report.color).toBe('white');
  expect(report.audit.finiteParticles).toBe(true);
  expect(report.audit.glError).toBe(0);
  expect(report.audit.lightOutput).toBeGreaterThan(0);
  expect(Math.abs(report.audit.lightOutput / report.audit.lightInput - 1)).toBeLessThan(.02);
  await page.screenshot({ path: testInfo.outputPath('local-core.png') });
  expect(errors).toEqual([]);
});

test('CPU and GPU reconstruct validated core samples and preserve the regular axis', async ({ page }, testInfo) => {
  await loadCore(page);
  const report = await page.evaluate(async () => {
    const { loadField, sampleVelocity } = await import('/src/field.ts');
    const field = await loadField('core');
    const reference = await (await fetch('/datasets/core-velocity-reference.json')).json();
    const renderer = (window as any).__observatory.renderer;
    let cpuFraction = 0, gpuFraction = 0;
    for (const sample of reference.samples) {
      const cpu = sampleVelocity(field, sample.position, sample.time);
      const gpu = renderer.auditVelocity(sample.position, sample.time);
      if (!cpu || !gpu.valid || gpu.glError) throw new Error(`Invalid core reference: ${JSON.stringify({ sample, gpu })}`);
      for (let k = 0; k < 3; k++) {
        const tolerance = reference.suggestedAbsoluteTolerance
          + Math.abs(sample.velocity[k]) * reference.suggestedRelativeTolerance;
        cpuFraction = Math.max(cpuFraction, Math.abs(cpu[k] - sample.velocity[k]) / tolerance);
        gpuFraction = Math.max(gpuFraction, Math.abs(gpu.velocity[k] - sample.velocity[k]) / tolerance);
      }
    }
    const axis = [field.manifest.time.start, field.manifest.time.end].map(time => ({
      cpu: sampleVelocity(field, [0, 0, 0], time), gpu: renderer.auditVelocity([0, 0, 0], time),
    }));
    const invalidCPU = [
      sampleVelocity(field, [100, 0, 0], .5), sampleVelocity(field, [0, 0, 100], .5),
      sampleVelocity(field, [0, 0, 0], 1), sampleVelocity(field, [0, 0, 0], -.01),
      sampleVelocity(field, [NaN, 0, 0], .5), sampleVelocity(field, [0, 0, 0], NaN),
    ];
    const invalidGPU = [[100, 0, 0], [0, 0, 100]].map(position => renderer.auditVelocity(position, .5).valid);
    invalidGPU.push(renderer.auditVelocity([0, 0, 0], 1).valid,
      renderer.auditVelocity([0, 0, 0], -.01).valid);
    return { cpuFraction, gpuFraction, axis, invalidCPU, invalidGPU, sampleCount: reference.samples.length };
  });
  expect(report.sampleCount).toBeGreaterThan(5);
  expect(report.cpuFraction).toBeLessThanOrEqual(1);
  expect(report.gpuFraction).toBeLessThanOrEqual(1);
  expect(report.invalidCPU).toEqual([null, null, null, null, null, null]);
  expect(report.invalidGPU).toEqual([false, false, false, false]);
  for (const point of report.axis) {
    for (const value of point.cpu!.slice(0, 2)) expect(Math.abs(value)).toBe(0);
    expect(point.gpu.valid).toBe(true);
    for (const value of point.gpu.velocity.slice(0, 2)) expect(Math.abs(value)).toBe(0);
    expect(point.cpu![2]).toBeGreaterThan(0);
    expect(point.gpu.velocity.every(Number.isFinite)).toBe(true);
  }
  expect(report.axis[1].cpu![2]).toBeGreaterThan(10 * report.axis[0].cpu![2]);
  await testInfo.attach('core-reference-audit', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});

test('scrubbing to the near-singular endpoint and reframing keeps the core visible', async ({ page }, testInfo) => {
  await loadCore(page);
  await page.locator('#toggle-play').click();
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.time)).toBeGreaterThan(0);
  await page.getByText('Time & transport', { exact: true }).click();
  await page.locator('#simulation-time').evaluate(element => {
    const input = element as HTMLInputElement;
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return s.time === s.timeMax && !s.playing;
  })).toBe(true);
  await page.locator('#reset-view').click();
  await page.locator('#control-independentDust').check();
  const reframeTime = await page.evaluate(() => performance.now());
  await expect.poll(() => page.evaluate(after => {
    const app = (window as any).__observatory;
    const audit = app.renderer.audit();
    const active = audit.particleSamples.some((value: number, i: number) => i % 4 === 3 && value > .1);
    const reframed = audit.particleSamples.every((value: number, i: number) => i % 4 === 3 || Math.abs(value) < .1);
    return audit.lightMeasuredAt > after && audit.lightInput > 0 && active && reframed && app.state.ship.scale < .05;
  }, reframeTime)).toBe(true);
  const report = await page.evaluate(() => {
    const app = (window as any).__observatory;
    return { audit: app.renderer.audit(), scale: app.state.ship.scale,
      time: app.state.time, end: app.state.timeMax };
  });
  expect(report.audit.finiteParticles).toBe(true);
  expect(report.audit.glError).toBe(0);
  expect(Number.isFinite(report.audit.lightOutput)).toBe(true);
  expect(report.time).toBe(report.end);
  await page.screenshot({ path: testInfo.outputPath('near-singular-core.png') });
});

test('corrupted core data fails closed with playback unavailable', async ({ page }) => {
  await page.route('**/datasets/core-manifest.json', async route => {
    const response = await route.fetch();
    const manifest = await response.json();
    const chunk = manifest.chunks.find((item: { kind: string }) => item.kind === 'core-profile');
    chunk.sha256 = '0'.repeat(64);
    await route.fulfill({ response, json: manifest });
  });
  await page.goto('/?debug=1');
  await expect(page.getByRole('alert')).toHaveText(/checksum.*(?:match|mismatch)/i);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#toggle-play')).toBeDisabled();
});
