import { expect, test } from '@playwright/test';

interface ProjectionCase {
  orientation: string;
  fov: number;
  regions: { name: string; mean: number }[];
  centerToOuter: number;
  maxToMin: number;
}

test('a uniform dust shell has no camera-centered brightness bias across field of view and rotation', async ({ page }, testInfo) => {
  await page.goto('/?field=exterior&debug=1');
  await page.waitForFunction(() => {
    const app = (window as any).__observatory;
    return app && !app.state.loading;
  });

  // The deterministic shell is contained entirely in the valid field domain.
  // Raw HDR regions avoid display clipping and redistribution masking a bias.
  const audit: { cases: ProjectionCase[]; glError: number } = await page.evaluate(
    () => (window as any).__observatory.renderer.auditProjection(),
  );
  await testInfo.attach('projection-brightness-audit', {
    body: JSON.stringify(audit, null, 2),
    contentType: 'application/json',
  });
  console.info('Projection GPU audit:', JSON.stringify(audit.cases.map(({ regions, ...summary }) => summary)));
  expect(audit.glError).toBe(0);
  expect(audit.cases).toHaveLength(6);
  expect([...new Set(audit.cases.map(sample => sample.fov))].sort((a, b) => a - b)).toEqual([65, 100]);
  for (const fov of [65, 100]) {
    expect(new Set(audit.cases.filter(sample => sample.fov === fov).map(sample => sample.orientation)).size).toBe(3);
  }
  for (const sample of audit.cases) {
    const label = `${sample.orientation}, FOV ${sample.fov}`;
    expect(sample.regions.length, label).toBeGreaterThanOrEqual(5);
    for (const region of sample.regions) {
      expect(Number.isFinite(region.mean), `${label}, ${region.name}`).toBe(true);
      expect(region.mean, `${label}, ${region.name}`).toBeGreaterThan(0);
    }
    expect(Math.abs(sample.centerToOuter - 1), label).toBeLessThan(.08);
    expect(sample.maxToMin, label).toBeLessThan(1.12);
  }
});

test('mobile exposure remains consistent across portrait, landscape, and render resolution', async ({ page }) => {
  await page.goto('/?field=exterior&debug=1');
  await page.waitForFunction(() => (window as any).__observatory?.renderer);
  const samples = await page.evaluate(() => {
    const renderer = (window as any).__observatory.renderer;
    return [[320, 180], [160, 90], [195, 422]].map(([width, height]) => ({
      width, height, ...renderer.auditProjection(width, height),
    }));
  });
  const reference = samples[0].cases[0].regions[0].mean;
  for (const sample of samples) {
    expect(sample.glError).toBe(0);
    for (const view of sample.cases) for (const region of view.regions) {
      expect(Math.abs(region.mean / reference - 1)).toBeLessThan(.1);
    }
  }
});
