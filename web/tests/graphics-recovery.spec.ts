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

test('Gyro permission pauses rendering and the viewer clock without a catch-up interval', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true,
      value: () => new Promise(resolve => { (window as any).__resolveGyro = resolve; }) });
  });
  await load(page);
  await page.locator('#explore-flow').tap();
  await page.locator('#touch-gyro').tap();
  await page.waitForFunction(() => (window as any).__observatory.state.gyroPending);
  const report = await page.evaluate(async () => {
    const app = (window as any).__observatory, s = app.state;
    const snapshot = () => ({ time: s.time, phase: s.introProgress, position: [...s.ship.position], orientation: [...s.ship.orientation] });
    const before = snapshot();
    const original = app.renderer.render.bind(app.renderer);
    let renders = 0;
    app.renderer.render = (...args: any[]) => { renders++; original(...args); };
    await new Promise(resolve => setTimeout(resolve, 400));
    const after = snapshot(), rendersWhilePending = renders;
    (window as any).__permissionResume = null;
    app.renderer.render = (...args: any[]) => {
      if (!(window as any).__permissionResume) (window as any).__permissionResume = {
        wall: args[0], timeDelta: args[2], speed: s.playbackSpeed, at: performance.now(),
      };
      original(...args);
    };
    const resolvedAt = performance.now();
    (window as any).__resolveGyro('granted');
    return { before, after, rendersWhilePending, resolvedAt };
  });
  expect(report.after).toEqual(report.before);
  expect(report.rendersWhilePending).toBe(0);
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.gyroActive && !s.gyroPending && (window as any).__permissionResume;
  });
  const first = await page.evaluate(() => (window as any).__permissionResume);
  const elapsedAfterPermission = (first.at-report.resolvedAt)/1000;
  expect(first.timeDelta).toBeLessThanOrEqual(first.speed*(elapsedAfterPermission+.03));
  expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
});

test('lost graphics rebuild from cached data, preserve manual settings, and bound recovery attempts', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [], datasetRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/datasets/')) datasetRequests.push(request.url()); });
  await page.addInitScript(() => {
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true,
      value: () => Promise.resolve('granted') });
  });
  await load(page, true);
  await page.locator('#enter-flight').tap();
  await page.locator('#touch-gyro').tap();
  await page.waitForFunction(() => (window as any).__observatory.state.gyroActive);
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
      scale: s.ship.scale, exposure: s.exposure, fov: s.fov }, gyro: s.gyroActive,
      pending: s.gyroPending, playing: s.playing, hud: s.hudActive, audit: app.renderer.audit() };
  });
  expect(recovered.snapshot).toEqual(before);
  expect(recovered.gyro).toBe(false); expect(recovered.pending).toBe(false);
  expect(recovered.playing).toBe(false); expect(recovered.hud).toBe(true);
  expect(recovered.audit.finiteParticles).toBe(true); expect(recovered.audit.glError).toBe(0);
  expect(datasetRequests).toEqual(initialRequests);

  await page.locator('#touch-auto').tap();
  await page.locator('#explore-flow').tap();
  await page.evaluate(() => Object.defineProperty(DeviceOrientationEvent, 'requestPermission', {
    configurable: true, value: () => new Promise(resolve => { (window as any).__lateGyroPermission = resolve; }),
  }));
  await page.locator('#touch-gyro').tap();
  await page.waitForFunction(() => (window as any).__observatory.state.gyroPending);
  await lose(); await restore();
  await page.evaluate(async () => {
    (window as any).__lateGyroPermission('granted');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return { intro: s.introActive, shot: s.introShot, hud: s.hudActive, gyro: s.gyroActive, pending: s.gyroPending };
  })).toEqual({ intro: true, shot: 0, hud: true, gyro: false, pending: false });
  expect(datasetRequests).toEqual(initialRequests);
  // A repeatedly failing device must not enter an endless allocation loop.
  await lose();
  await expect(page.getByRole('alert')).toContainText('Graphics could not recover reliably');
  expect(await page.evaluate(() => (window as any).__observatory.state.flowAvailable)).toBe(false);
  expect(errors).toEqual([]);
});
