import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/particle-profile-fixture', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Particle profile quadrature</title>',
  }));
  await page.goto('/particle-profile-fixture');
});

test('Cartesian quadrature conserves light for faint Gaussians and white ellipses of different aspect ratios', async ({ page }) => {
  const cases = await page.evaluate(async () => {
    const { particleProfileParameters, particleProfileIntensity, PARTICLE_PROFILE_MASS } = await import('/src/particle-profile.ts');
    const results = [];
    for (const [sx, sy] of [[1, 1], [.5, 5], [8, .25]]) {
      const threshold = 2 * Math.PI * sx * sy * PARTICLE_PROFILE_MASS;
      for (const multiplier of [0, .05, .5, 1, 1.001, 2, 10, 100]) {
        const light = threshold * multiplier, profile = particleProfileParameters(light, sx, sy);
        const radius = Math.sqrt(2 * profile.cutoff), nx = 360, ny = 360;
        const dx = 2 * radius * sx / nx, dy = 2 * radius * sy / ny;
        let integral = 0, peak = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const x = -radius * sx + (i + .5) * dx;
          const y = -radius * sy + (j + .5) * dy;
          const intensity = particleProfileIntensity(.5 * ((x / sx) ** 2 + (y / sy) ** 2), profile);
          integral += intensity * dx * dy; peak = Math.max(peak, intensity);
        }
        results.push({ sx, sy, multiplier, light, integral, peak, profile });
      }
    }
    return results;
  });
  for (const sample of cases) {
    expect(Math.abs(sample.integral - sample.light) / Math.max(1, sample.light)).toBeLessThan(.001);
    expect(sample.peak).toBeLessThanOrEqual(1);
    expect(sample.profile.plateau > 0).toBe(sample.multiplier > 1);
    if (sample.multiplier >= 2) expect(sample.peak).toBe(1);
  }
});

test('normal light remains Gaussian and the threshold joins continuously to a white plateau', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { particleProfileParameters, particleProfileIntensity, PARTICLE_PROFILE_MASS } = await import('/src/particle-profile.ts');
    const sx = 3, sy = .75, threshold = 2 * Math.PI * sx * sy * PARTICLE_PROFILE_MASS;
    const faint = particleProfileParameters(.3 * threshold, sx, sy);
    const below = particleProfileParameters(threshold * (1 - 1e-8), sx, sy);
    const at = particleProfileParameters(threshold, sx, sy);
    const above = particleProfileParameters(threshold * (1 + 1e-8), sx, sy);
    return {
      faint: [0, .1, 1, 3, 4.5].map(q => ({ q, value: particleProfileIntensity(q, faint) })),
      threshold: [0, .1, 1, 3, 4.49].map(q => ({ below: particleProfileIntensity(q, below), at: particleProfileIntensity(q, at), above: particleProfileIntensity(q, above) })),
      supports: [below.cutoff, at.cutoff, above.cutoff],
    };
  });
  for (const point of result.faint) expect(point.value).toBeCloseTo(.3 * Math.exp(-point.q), 12);
  for (const point of result.threshold) {
    expect(Math.abs(point.below - point.at)).toBeLessThan(2e-8);
    expect(Math.abs(point.above - point.at)).toBeLessThan(2e-8);
  }
  expect(Math.abs(result.supports[2] - result.supports[0])).toBeLessThan(2e-8);
});

test('the saturated center is an ellipse with its original axis ratio and a truncated Gaussian edge', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { particleProfileParameters, particleProfileIntensity, PARTICLE_PROFILE_CUTOFF, PARTICLE_PROFILE_MASS } = await import('/src/particle-profile.ts');
    const sx = 7, sy = .4;
    const profile = particleProfileParameters(20 * 2 * Math.PI * sx * sy * PARTICLE_PROFILE_MASS, sx, sy);
    const value = (x: number, y: number) => particleProfileIntensity(.5 * ((x / sx) ** 2 + (y / sy) ** 2), profile);
    const whiteRadius = Math.sqrt(2 * profile.plateau), supportRadius = Math.sqrt(2 * profile.cutoff);
    return { center: value(0, 0), plateau: value(.99 * sx * whiteRadius, 0),
      plateauY: value(0, .99 * sy * whiteRadius),
      edge: particleProfileIntensity(profile.plateau + 1, profile),
      cutoff: particleProfileIntensity(profile.cutoff, profile),
      outside: particleProfileIntensity(profile.cutoff + 1e-6, profile),
      infinity: particleProfileIntensity(Infinity, profile),
      expectedCutoff: Math.exp(-PARTICLE_PROFILE_CUTOFF),
      semiAxes: [sx * supportRadius, sy * supportRadius], ratio: sx / sy };
  });
  expect(report.center).toBe(1); expect(report.plateau).toBe(1); expect(report.plateauY).toBe(1);
  expect(report.edge).toBeCloseTo(Math.exp(-1), 12);
  expect(report.cutoff).toBeCloseTo(report.expectedCutoff, 12);
  expect(report.outside).toBe(0); expect(report.infinity).toBe(0);
  expect(report.semiAxes[0] / report.semiAxes[1]).toBeCloseTo(report.ratio, 12);
});

test('invalid energies and widths fail explicitly instead of creating nonfinite footprints', async ({ page }) => {
  const rejected = await page.evaluate(async () => {
    const { particleProfileParameters } = await import('/src/particle-profile.ts');
    return [[-1, 1, 1], [Infinity, 1, 1], [1, 0, 1], [1, 1, NaN], [1, 1e308, 1e308], [1e308, 1e-308, 1e-308]]
      .map(([light, sx, sy]) => { try { particleProfileParameters(light, sx, sy); return false; } catch { return true; } });
  });
  expect(rejected.every(Boolean)).toBe(true);
});
