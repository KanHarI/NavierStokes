import { expect, test, type Page } from '@playwright/test';

async function load(page: Page) {
  await page.goto('/?intro=0&debug=1');
  await page.waitForFunction(() => {
    const app = (window as any).__observatory;
    return app && !app.state.loading && app.renderer;
  });
}

test('default field covers the old gaps and agrees with independent velocity references', async ({ page }, info) => {
  await load(page);
  const report = await page.evaluate(async () => {
    const { sampleVelocity } = await import('/src/field.ts');
    const app = (window as any).__observatory, field = app.renderer.field;
    const reference = await (await fetch('/datasets/extended-velocity-reference.json')).json();
    const samples = reference.samples.map((s: any) => ({ ...s,
      cpu: sampleVelocity(field, s.position, s.time), gpu: app.renderer.auditVelocity(s.position, s.time) }));
    const surroundings = [[.6, 0, 0], [.8, 0, .5], [0, 0, 2], [6, 0, 0], [9, 0, 0]]
      .map(position => ({ position, cpu: sampleVelocity(field, position, .9999), gpu: app.renderer.auditVelocity(position, .9999) }));
    return { status: field.manifest.status, samples, surroundings, reference };
  });
  expect(report.status).toBe('extended-flow-checkpoint');
  expect(report.samples.length).toBeGreaterThan(10);
  for (const sample of report.samples) {
    expect(sample.cpu).not.toBeNull(); expect(sample.gpu.valid).toBe(true); expect(sample.gpu.glError).toBe(0);
    for (let k = 0; k < 3; k++) {
      const tolerance = report.reference.suggestedAbsoluteTolerance
        + Math.abs(sample.velocity[k]) * report.reference.suggestedRelativeTolerance;
      expect(Math.abs(sample.cpu[k] - sample.velocity[k])).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(sample.gpu.velocity[k] - sample.velocity[k])).toBeLessThanOrEqual(tolerance);
    }
  }
  for (const sample of report.surroundings) {
    expect(sample.cpu!.every(Number.isFinite)).toBe(true);
    expect(sample.gpu.valid).toBe(true); expect(sample.gpu.glError).toBe(0);
  }
  expect(Math.hypot(...report.surroundings[0].cpu!)).toBeGreaterThan(0);
  expect(report.surroundings.at(-1)!.cpu).toEqual([0, 0, 0]);
  expect(report.surroundings.at(-1)!.gpu.velocity).toEqual([0, 0, 0]);
  await info.attach('extended-reference-audit', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});

test('stationary ambient dust survives full playback and independent transport without moving', async ({ page }) => {
  await load(page);
  const report = await page.evaluate(() => {
    const app = (window as any).__observatory, s = app.state, r = app.renderer;
    s.playing = false; s.ship.position = [20, 0, 0]; s.ship.scale = .25;
    s.density = .1; s.renderScale = .5; s.time = 0;
    r.reseed(); r.render(1, 0, 0);
    const before = r.audit();
    s.time = .9999; r.render(1, .9999, .9999);
    const after = r.audit();
    r.render(1, .1, 0); const frozen = r.audit();
    // Even an overloaded independent multiplier must keep stationary dust.
    r.render(1, 10, .9999); const overloaded = r.audit();
    return { before, after, frozen, overloaded };
  });
  expect(report.before.particleSamples.length).toBe(400);
  expect(report.after.transport.reseed).toBe(false);
  expect(report.after.transport.actualDelta).toBe(.9999);
  for (const state of [report.after, report.frozen, report.overloaded]) {
    expect(state.glError).toBe(0); expect(state.finiteParticles).toBe(true);
    for (let i = 0; i < 100; i++) {
      expect(state.particleSamples.slice(4*i, 4*i+3)).toEqual(report.before.particleSamples.slice(4*i, 4*i+3));
      expect(state.particleSamples[4*i+3]).toBeGreaterThan(0);
    }
  }
});

test('extended shell recycling introduces particles only at zero opacity', async ({ page }) => {
  await load(page);
  const audit = await page.evaluate(() => (window as any).__observatory.renderer.auditShellRecycling());
  expect(audit.births).toBeGreaterThan(0); expect(audit.maximumBirthOpacity).toBe(0);
  expect(audit.finite).toBe(true); expect(audit.glError).toBe(0);
});

test('corrupt extended swirl data fails closed', async ({ page }) => {
  await page.route('**/datasets/extended-swirl.bin', async route => {
    const response = await route.fetch(), bytes = Buffer.from(await response.body());
    bytes[0] ^= 1; await route.fulfill({ response, body: bytes });
  });
  await page.goto('/?intro=0&debug=1');
  await expect(page.getByRole('alert')).toContainText('checksum');
  expect(await page.evaluate(() => (window as any).__observatory.renderer)).toBeUndefined();
});

test('heat exterior orbits preserve radius and match quadrature through the complete interval', async ({ page }) => {
  await load(page);
  const report = await page.evaluate(async () => {
    const { sampleVelocity } = await import('/src/field.ts');
    const app = (window as any).__observatory, s = app.state, r = app.renderer;
    s.playing = false; s.ship.position = [3, 0, 0]; s.ship.scale = .03;
    s.density = .1; s.renderScale = .5; s.time = 0;
    r.reseed(); r.render(1, 0, 0); const before = r.audit();
    s.time = .9999; r.render(1, .9999, .9999); const after = r.audit();
    const nodes = [.1834346424956498, .525532409916329, .7966664774136267, .9602898564975363];
    const weights = [.362683783378362, .3137066458778873, .2223810344533745, .1012285362903763];
    let maximumError = 0, maximumRadiusError = 0, retained = 0, worst: any = null;
    for (let i = 0; i < 100; i++) {
      // The ship's shell is fixed in space; an orbit may legitimately leave
      // its guard volume and be replaced. Compare trajectories that remain.
      if (after.particleSamples[i*4+3] !== 1) continue;
      retained++;
      const p = before.particleSamples.slice(i*4, i*4+3), out = after.particleSamples.slice(i*4, i*4+3);
      let angle = 0;
      for (let k = 0; k < 4; k++) for (const sign of [-1, 1]) {
        const v = sampleVelocity(r.field, p, .9999*(.5+sign*.5*nodes[k]))!;
        angle += .9999*.5*weights[k]*(p[0]*v[1]-p[1]*v[0])/(p[0]**2+p[1]**2);
      }
      const expected = [Math.cos(angle)*p[0]-Math.sin(angle)*p[1], Math.sin(angle)*p[0]+Math.cos(angle)*p[1], p[2]];
      if (Math.hypot(...out.map((x: number, k: number) => x-expected[k])) > maximumError) worst = {p, out, expected, angle};
      maximumError = Math.max(maximumError, Math.hypot(...out.map((x: number, k: number) => x-expected[k])));
      maximumRadiusError = Math.max(maximumRadiusError, Math.abs(Math.hypot(...p)-Math.hypot(...out)));
    }
    return { maximumError, maximumRadiusError, retained, worst, transport: after.transport, glError: after.glError };
  });
  expect(report.glError).toBe(0); expect(report.transport.reseed).toBe(false);
  expect(report.retained).toBeGreaterThan(70);
  expect(report.maximumError, JSON.stringify(report)).toBeLessThan(1e-6); expect(report.maximumRadiusError).toBeLessThan(1e-6);
});
