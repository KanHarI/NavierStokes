import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

async function load(page: Page, manual = false) {
  await page.goto(`/?debug=1${manual ? '&intro=0' : ''}`);
  await page.waitForFunction(() => (window as any).__observatory?.startup.firstFrameReady > 0);
  await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.density = 10; s.renderScale = .35;
  });
}

test('lost graphics rebuild from cached data, preserve manual settings, and bound recovery attempts', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [], datasetRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/datasets/')) datasetRequests.push(request.url()); });
  await load(page, true);
  await page.locator('#enter-flight').tap();
  const before = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.time = .45; s.playing = false; s.exposure = -.75; s.fov = 71;
    s.ship.position = [.1, -.6, .2]; s.ship.scale = .3;
    return { time: s.time, position: [...s.ship.position], orientation: [...s.ship.orientation],
      scale: s.ship.scale, exposure: s.exposure, fov: s.fov };
  });
  const initialRequests = [...datasetRequests];
  const lose = async () => {
    expect(await page.evaluate(() => {
      const app = (window as any).__observatory;
      const extension = app.renderer.gl.getExtension('WEBGL_lose_context');
      (window as any).__restoreGraphics = () => extension.restoreContext();
      extension?.loseContext(); return !!extension;
    })).toBe(true);
    await page.waitForFunction(() => !(window as any).__observatory.renderer);
  };
  const restore = async () => {
    await page.evaluate(() => (window as any).__restoreGraphics());
    await page.waitForFunction(() => {
      const app = (window as any).__observatory;
      return app.renderer && app.startup.firstFrameReady > 0 && !app.state.loading;
    }, null, { timeout: 30_000 });
    await expect(page.locator('#startup-loader')).toBeHidden();
  };
  await lose();
  await expect(page.locator('#startup-loader')).toBeVisible();
  await expect(page.locator('#startup-stage')).toHaveText('Restoring graphics…');
  await restore();
  const recovered = await page.evaluate(() => {
    const app = (window as any).__observatory, s = app.state;
    return { snapshot: { time: s.time, position: [...s.ship.position], orientation: [...s.ship.orientation],
      scale: s.ship.scale, exposure: s.exposure, fov: s.fov }, playing: s.playing, hud: s.hudActive, audit: app.renderer.audit() };
  });
  expect(recovered.snapshot).toEqual(before);
  expect(recovered.playing).toBe(false); expect(recovered.hud).toBe(true);
  expect(recovered.audit.finiteParticles).toBe(true); expect(recovered.audit.glError).toBe(0);
  expect(datasetRequests).toEqual(initialRequests);

  await page.locator('#touch-auto').tap();
  await page.locator('#explore-flow').tap();
  await lose(); await restore();
  expect(await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return { intro: s.introActive, shot: s.introShot, hud: s.hudActive };
  })).toEqual({ intro: true, shot: 0, hud: true });
  expect(datasetRequests).toEqual(initialRequests);
  // A repeatedly failing device must not enter an endless allocation loop.
  await lose();
  await expect(page.getByRole('alert')).toContainText('Graphics could not recover reliably');
  expect(await page.evaluate(() => (window as any).__observatory.state.flowAvailable)).toBe(false);
  expect(errors).toEqual([]);
});
