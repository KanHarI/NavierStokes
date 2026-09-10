import { expect, test } from '@playwright/test';

test('bright particle halos are continuous while dim points retain their original footprint', async ({ page }, info) => {
  await page.goto('/?field=exterior&debug=1');
  await page.waitForFunction(() => (window as any).__observatory?.renderer);
  const audit = await page.evaluate(() => (window as any).__observatory.renderer.auditLight(true));
  expect(audit.glError).toBe(0);
  const [bright, dim] = audit.cases;
  for (const sample of audit.cases) {
    expect(sample.relativeError).toBeLessThan(.01);
    expect(sample.overflow / sample.input).toBeLessThan(.03);
    // No repeated peaks at 2/4/8/16-pixel spacing after the central point.
    for (let x = 1; x < sample.row.length; x++) {
      expect(sample.row[x]).toBeLessThanOrEqual(sample.row[x-1] + 1e-6);
    }
  }
  expect(bright.row[8]).toBeGreaterThan(.001);
  const outside = bright.pixels.reduce((sum: number, value: number, index: number) => {
    const x = index % audit.size - audit.size/2, y = Math.floor(index/audit.size) - audit.size/2;
    return sum + (Math.hypot(x, y) > 15 ? value : 0);
  }, 0);
  expect(outside / bright.output).toBeLessThan(.05);
  for (let x = 0; x < dim.row.length; x++) {
    const expected = .5 * Math.exp(-x*x/4.5);
    expect(Math.abs(dim.row[x] - expected)).toBeLessThan(.0003);
  }
  // Show the actual GPU readback with the same linear-to-sRGB transfer as
  // the display shader. Enlarging this panel makes residual grid dots clear.
  await page.evaluate(({ size, pixels }) => {
    const canvas = document.createElement('canvas'); canvas.id = 'halo-readback';
    canvas.width = canvas.height = size;
    canvas.style.cssText = 'position:fixed;inset:0;width:512px;height:512px;z-index:100;background:black;image-rendering:pixelated';
    const context = canvas.getContext('2d')!, data = context.createImageData(size, size);
    pixels.forEach((value: number, i: number) => {
      const c = Math.max(0, Math.min(1, value));
      const encoded = Math.round(255 * (c <= .0031308 ? 12.92*c : 1.055*c**(1/2.4)-.055));
      data.data.set([encoded, encoded, encoded, 255], i*4);
    });
    context.putImageData(data, 0, 0); document.body.append(canvas);
  }, { size: audit.size, pixels: bright.pixels });
  await page.locator('#halo-readback').screenshot({ path: info.outputPath('smooth-bright-particle.png') });
  await info.attach('halo-profile', { body: JSON.stringify(audit.cases.map(({ pixels: _pixels, ...sample }: any) => sample)), contentType: 'application/json' });
});


test('overexposed particles swell into white motion ellipses while conserving their light', async ({ page }) => {
  await page.goto('/?field=exterior&intro=0&debug=1');
  await page.waitForFunction(() => (window as any).__observatory?.startup.firstFrameReady > 0);
  const report = await page.evaluate(() => {
    const renderer = (window as any).__observatory.renderer;
    return { faint: renderer.auditGaussian(0, false, -4), bright: renderer.auditGaussian(0, false, 4),
      moving: renderer.auditGaussian(4, false, 4) };
  });
  for (const audit of Object.values(report)) {
    expect(audit.glError).toBe(0);
    for (const point of audit.cases) {
      expect(Math.abs(point.light/audit.expectedLight - 1)).toBeLessThan(.01);
      expect(point.peak).toBeLessThanOrEqual(1);
    }
  }
  const faint = report.faint.cases[1], bright = report.bright.cases[1], moving = report.moving.cases[1];
  expect(faint.whitePixels).toBe(0);
  expect(bright.whitePixels).toBeGreaterThan(20);
  expect(bright.rmsRadius).toBeGreaterThan(2*faint.rmsRadius);
  expect(moving.whitePixels).toBeGreaterThan(0);
  expect(Math.max(moving.xVariance, moving.yVariance)/Math.min(moving.xVariance, moving.yVariance)).toBeGreaterThan(2);
});
