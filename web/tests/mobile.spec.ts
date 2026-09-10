import { expect, test, type CDPSession, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

type Touch = { id: number; x: number; y: number };
async function touches(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Touch[]) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point => ({ ...point, radiusX: 3, radiusY: 3, force: 1 })) });
}

test('real touch gestures steer the movie, adjust radar, and expose complete manual controls', async ({ page }) => {
  test.setTimeout(65_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as any).__observatory?.startup.firstFrameReady > 0);
  await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.density = 10; s.renderScale = .35;
  });
  await expect(page.locator('#startup-loader')).toBeHidden();
  await expect(page.locator('#explore-flow')).toHaveText(/Tap to look around/);
  await page.locator('#explore-flow').tap();
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.touchControls && s.hudActive && s.introActive && !s.pointerLocked && !document.pointerLockElement;
  });
  await expect(page.locator('.touch-toolbar')).toBeVisible();
  await expect(page.locator('#touch-gyro')).toBeHidden();
  await expect(page.locator('.touch-hint')).toContainText('Drag to look');
  const session = await page.context().newCDPSession(page);
  const before = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    return { time: s.time, shot: s.introShot };
  });
  await touches(session, 'touchStart', [{ id: 1, x: 160, y: 420 }]);
  await touches(session, 'touchMove', [{ id: 1, x: 190, y: 425 }]);
  await touches(session, 'touchMove', [{ id: 1, x: 220, y: 435 }]);
  await touches(session, 'touchEnd', []);
  await page.waitForFunction(previous => {
    const s = (window as any).__observatory.state;
    const [x,y,z,w] = s.ship.orientation, distance = Math.hypot(...s.ship.position);
    const forward = [-2*(x*z+w*y), 2*(w*x-y*z), 2*(x*x+y*y)-1];
    const alignment = forward.reduce((sum,value,i) => sum-value*s.ship.position[i]/distance, 0);
    return s.introActive && s.introShot === previous.shot && s.time > previous.time && alignment < .999;
  }, before);
  const radarBefore = await page.evaluate(() => (window as any).__observatory.state.far);
  // Spreading fingers magnifies the radar view by reducing its physical range.
  await touches(session, 'touchStart', [{ id: 1, x: 145, y: 430 }, { id: 2, x: 245, y: 430 }]);
  await touches(session, 'touchMove', [{ id: 1, x: 120, y: 430 }, { id: 2, x: 270, y: 430 }]);
  await touches(session, 'touchMove', [{ id: 1, x: 95, y: 430 }, { id: 2, x: 295, y: 430 }]);
  await touches(session, 'touchEnd', []);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.far)).toBeLessThan(radarBefore*.7);
  expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.locator('#touch-manual').tap();
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return !s.introActive && !s.playing && s.hudActive;
  });
  await expect(page.locator('#touch-manual')).toHaveText('Play');
  await page.locator('#touch-settings').tap();
  await expect(page.locator('#flight-controls')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__observatory.state.touchSettings)).toBe(true);
  await page.locator('#touch-close').tap();
  await expect(page.locator('#flight-controls')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__observatory.state.touchSettings)).toBe(false);
  await page.locator('#touch-auto').tap();
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.introActive && !s.hudActive;
  });
  await expect(page.locator('#explore-flow')).toBeVisible();
  await page.locator('#screensaver').tap();
  await page.waitForFunction(() => (window as any).__observatory.state.screensaver);
  await expect(page.locator('#interface button:visible')).toHaveCount(0);
  await page.touchscreen.tap(195, 420);
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return !s.screensaver && s.introActive;
  });
  await expect(page.locator('#explore-flow')).toBeVisible();
  const audit = await page.evaluate(() => (window as any).__observatory.renderer.audit());
  expect(audit.finiteParticles).toBe(true); expect(audit.glError).toBe(0);
  expect(errors).toEqual([]);
  await session.detach();
});

async function expectTouchBox(page: Page, selector: string, viewport: { width: number; height: number }, button = false) {
  const element = page.locator(selector);
  await expect(element).toBeVisible();
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);
  expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);
  if (button) expect(box!.height).toBeGreaterThanOrEqual(44);
}

test('touch layout fits portrait and short landscape with accessible action sizes', async ({ page }, info) => {
  await page.route('**/mobile-layout-host', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="interface"></div>' }));
  await page.goto('/mobile-layout-host');
  await page.evaluate(async () => {
    const { createUI } = await import('/src/ui.ts'), { initialState } = await import('/src/types.ts');
    await import('/src/styles.css');
    const state = initialState();
    Object.assign(state, { touchControls: true, introActive: true, introTitle: 'Inside the accelerating swirl.',
      introDuration: 12, introCaption: 'The fluid accelerates as its core contracts. Linear time stops before the singularity.',
      loading: false, flowAvailable: true, playing: true });
    const ui = createUI(document.querySelector('#interface')!, state, {
      startIntro() { state.introActive = true; ui.update(); },
      stopIntro() { state.introActive = false; state.playing = false; ui.update(); },
      reset() {}, reseed() {}, scrub() {},
      enterFlight() { state.introActive = false; state.hudActive = true; ui.update(); },
      lookAround() { state.hudActive = true; ui.update(); },
      startScreensaver() { state.screensaver = true; ui.update(); },
      returnToAuto() { state.introActive = true; state.hudActive = false; state.touchSettings = false; ui.update(); },
    });
    Object.assign(window, { __mobileFixture: { state, ui } });
  });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const { state, ui } = (window as any).__mobileFixture;
      Object.assign(state, { introActive: true, hudActive: false, touchSettings: false }); ui.update();
    });
    await expectTouchBox(page, '#explore-flow', viewport, true);
    await expectTouchBox(page, '#screensaver', viewport, true);
    await expectTouchBox(page, '#intro-card', viewport);
    await page.locator('#explore-flow').tap();
    await expectTouchBox(page, '.hud-instruments', viewport);
    for (const id of ['#touch-auto', '#touch-manual', '#touch-settings']) await expectTouchBox(page, id, viewport, true);
    await page.screenshot({ path: info.outputPath(`mobile-hud-${viewport.width}-${viewport.height}.png`) });
    await page.locator('#touch-settings').tap();
    await expectTouchBox(page, '#flight-controls', viewport);
    await expectTouchBox(page, '#touch-close', viewport, true);
    await page.locator('#touch-close').tap();
    await expect(page.locator('#flight-controls')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
