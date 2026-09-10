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
  expect(bright.row[32]).toBeGreaterThan(.001);
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
