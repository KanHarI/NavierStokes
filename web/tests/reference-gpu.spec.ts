import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

test('reference playback reaches the endpoint with the real mobile GPU and fixed framing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?intro=0&debug=1');
  await page.waitForFunction(() => (window as any).__observatory?.startup.firstFrameReady > 0);
  const view = await page.evaluate(() => {
    const a = (window as any).__observatory, s = a.state;
    Object.assign(s, { time: .98, playbackSpeed: .01, exposure: -1, density: 8 });
    a.renderer.reseed();
    return { ship: s.ship, exposure: s.exposure, focus: s.focus, near: s.near, far: s.far, density: s.density };
  });
  await page.locator('#reference-view').click();
  await page.waitForFunction(() => {
    const a = (window as any).__observatory, s = a.state;
    return s.time === s.timeMax && !s.playing && !a.renderer.hasPendingFrame;
  });
  const result = await page.evaluate(() => {
    const a = (window as any).__observatory, s = a.state;
    return { reference: s.referenceView, intro: s.introActive,
      view: { ship: s.ship, exposure: s.exposure, focus: s.focus, near: s.near, far: s.far, density: s.density },
      audit: a.renderer.audit(), count: s.particleCount };
  });
  expect(result.view).toEqual(view);
  expect(result.reference).toBe(true); expect(result.intro).toBe(false);
  expect(result.audit.glError).toBe(0); expect(result.audit.finiteParticles).toBe(true);
  expect(result.count).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  await page.locator('#reference-view').click();
  await expect(page.locator('#control-exposure')).toBeEnabled();
});
