import { expect, test } from '@playwright/test';

test('Screensaver enters fullscreen without text and Escape restores the continuing movie', async ({ page }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => {
    const app = (window as any).__observatory;
    return app?.startup.firstFrameReady > 0 && !app.state.loading;
  });
  await expect(page.locator('#startup-loader')).toBeHidden();
  await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.renderScale = .35; s.density = 10;
  });
  const before = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return { shot: s.introShot, phase: s.introProgress, time: s.time };
  });
  await page.getByRole('button', { name: 'Screensaver', exact: true }).click();
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.screensaver && s.introActive && document.fullscreenElement === document.documentElement;
  });
  await expect(page.locator('#interface button:visible')).toHaveCount(0);
  await expect(page.locator('#intro-card')).toBeHidden();
  await expect(page.locator('#flight-hud')).toBeHidden();
  await page.waitForFunction(previous => {
    const s = (window as any).__observatory.state;
    return s.introShot === previous.shot && s.introProgress > previous.phase+.01 && s.time > previous.time;
  }, before);
  const enteringEscape = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return { shot: s.introShot, phase: s.introProgress, time: s.time };
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return !s.screensaver && s.introActive && !document.fullscreenElement;
  });
  await expect(page.getByRole('button', { name: 'Screensaver', exact: true })).toBeVisible();
  await expect(page.locator('#explore-flow')).toBeVisible();
  const after = await page.evaluate(() => {
    const app = (window as any).__observatory, s = app.state;
    return { shot: s.introShot, phase: s.introProgress, time: s.time,
      hud: s.hudActive, audit: app.renderer.audit() };
  });
  expect(after.shot).toBe(enteringEscape.shot);
  expect(after.phase).toBeGreaterThanOrEqual(enteringEscape.phase);
  expect(after.time).toBeGreaterThanOrEqual(enteringEscape.time);
  expect(after.hud).toBe(false);
  expect(after.audit.finiteParticles).toBe(true);
  expect(after.audit.glError).toBe(0);
  expect(errors).toEqual([]);
});
