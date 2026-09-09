import { expect, test } from '@playwright/test';

for (const field of ['core', 'exterior']) test(`ordinary ${field} replacement dust is born at zero spatial opacity`, async ({ page }) => {
  await page.goto(`/?field=${field}&debug=1`);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__observatory?.renderer))).toBe(true);
  const report = await page.evaluate(() => (window as any).__observatory.renderer.auditShellRecycling());
  expect(report.births).toBeGreaterThan(0);
  expect(report.maximumBirthOpacity).toBe(0);
  expect(report.finite).toBe(true);
  expect(report.glError).toBe(0);
  const defaults = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return { near: s.near, far: s.far, focus: s.focus, transition: s.shellFade };
  });
  expect(defaults).toEqual({ near: 2, far: 4, focus: 3, transition: 1 });
});
