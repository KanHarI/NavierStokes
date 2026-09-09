import { expect, test } from '@playwright/test';

test('5/6 visibly change both Gaussian footprints while conserving particle light', async ({ page }) => {
  await page.goto('/?field=exterior&debug=1');
  await page.waitForFunction(() => (window as any).__observatory?.renderer);
  const report = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { state, renderer } = (window as any).__observatory;
    Object.assign(state, { introActive: false, pointerLocked: true, playing: false,
      near: 2, far: 4, focus: 3, shellFade: 1, blur: 6, shellBokeh: 24 });
    const navigation = createNavigation(document.querySelector('canvas')!, state);
    const sample = () => ({ blur: state.blur, shellBokeh: state.shellBokeh, ...renderer.auditGaussian(0, true) });
    const hold = (code: string) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code }));
      for (let i = 0; i < 40; i++) navigation.update(.1);
      document.dispatchEvent(new KeyboardEvent('keyup', { code }));
    };
    const initial = sample(); hold('Digit5'); const sharp = sample();
    hold('Digit6'); const soft = sample();
    navigation.dispose();
    return { initial, sharp, soft };
  });
  expect(report.sharp.blur).toBe(0); expect(report.sharp.shellBokeh).toBe(0);
  expect(report.soft.blur).toBe(30); expect(report.soft.shellBokeh).toBe(48);
  for (const sample of Object.values(report)) {
    expect(sample.glError).toBe(0);
    for (const point of sample.cases) {
      // The outer fade at 4.5 deliberately transmits half the particle light.
      const expectedLight = point.distance === 4.5 ? 6 : 12;
      expect(Math.abs(point.light / expectedLight - 1)).toBeLessThan(.02);
    }
  }
  for (const index of [0, 2]) {
    expect(report.soft.cases[index].rmsRadius).toBeGreaterThan(report.sharp.cases[index].rmsRadius * 3);
    expect(report.initial.cases[index].rmsRadius).toBeGreaterThan(report.sharp.cases[index].rmsRadius);
  }
  // Focus remains sharp; bokeh is a depth effect, not a whole-screen blur.
  expect(report.soft.cases[1].rmsRadius).toBeCloseTo(report.sharp.cases[1].rmsRadius, 4);
});
