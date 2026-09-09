import { expect, test } from '@playwright/test';

test('controls can disappear and return without touching cinematic playback', async ({ page }) => {
  // This uses the real UI and CSS without a costly GPU context. Actions are
  // deliberately observable: hiding controls must not invoke any of them.
  await page.route('**/interface-host', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><div id="interface"></div>',
  }));
  await page.goto('/interface-host');
  await page.evaluate(async () => {
    const { createUI } = await import('/src/ui.ts');
    const { initialState } = await import('/src/types.ts');
    await import('/src/styles.css');
    const state = initialState();
    Object.assign(state, { introActive: true, introTitle: 'Drawn inward.', introDuration: 12,
      introCaption: 'The core contracts.', loading: false, flowAvailable: true, playing: true });
    const calls: string[] = [];
    const ui = createUI(document.querySelector('#interface')!, state, {
      startIntro() { calls.push('start'); }, stopIntro() { calls.push('stop'); },
      reset() { calls.push('reset'); }, reseed() { calls.push('reseed'); },
      scrub() { calls.push('scrub'); }, enterFlight() { calls.push('flight'); },
      lookAround() { calls.push('look'); state.hudActive = true; ui.update(); },
      startScreensaver() { calls.push('screensaver'); state.screensaver = true; ui.update(); },
    });
    Object.assign(window, { __interfaceTest: { state, ui, calls } });
  });
  const toggle = page.locator('#toggle-interface');
  await expect(page.locator('#intro-card')).toBeVisible();
  await expect(page.locator('#take-control')).toBeHidden();
  await expect(page.locator('#flight-hud')).toBeHidden();
  await expect(toggle).toHaveText('Hide controls');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveText('Show controls');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#viewer-controls')).toBeHidden();
  await expect(page.getByRole('button')).toHaveCount(1);
  // Updates and shot changes must leave the interface hidden and the show
  // button focused; returning to manual mode must also keep that preference.
  await page.evaluate(() => {
    const { state, ui } = (window as any).__interfaceTest;
    state.introShot = 5; state.introProgress = .4; state.time = .96; ui.update();
  });
  await expect(toggle).toBeFocused();
  await expect(page.locator('#viewer-controls')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#intro-card')).toBeVisible();
  expect(await page.evaluate(() => {
    const { state, calls } = (window as any).__interfaceTest;
    return { calls, active: state.introActive, playing: state.playing, time: state.time };
  })).toEqual({ calls: [], active: true, playing: true, time: .96 });
  await page.getByRole('button', { name: 'Click to look around' }).click();
  expect(await page.evaluate(() => (window as any).__interfaceTest.calls)).toEqual(['look']);
  await expect(page.locator('#intro-card')).toBeHidden();
  await expect(page.locator('.mission-header')).toBeHidden();
  await expect(page.locator('#flight-hud')).toBeVisible();
  await expect(toggle).toHaveText('Hide HUD');
  await expect(page.locator('#hud-range')).not.toHaveText('');
  await page.evaluate(() => {
    const { state, ui } = (window as any).__interfaceTest;
    Object.assign(state, { near: 1.5, far: 4.5, focus: 3.2, blur: 12, exposure: 2, fov: 80, boosting: true, playing: false });
    state.ship.position = [1, 2, 3]; ui.update();
  });
  await expect(page.locator('#hud-setting-near')).toHaveText('1.50×');
  await expect(page.locator('#hud-setting-far')).toHaveText('4.50×');
  await expect(page.locator('#hud-setting-shellThickness')).toHaveText('3.00×');
  await expect(page.locator('#hud-setting-blur')).toHaveText('12.0');
  await expect(page.locator('#hud-setting-shellBokeh')).toHaveText('24.0 px');
  await expect(page.locator('#hud-setting-exposure')).toHaveText('+2.0 EV');
  await expect(page.locator('#hud-setting-boost')).toHaveText('4× active');
  await expect(page.locator('#hud-setting-movementSpeed')).toHaveText('2.00');
  await expect(page.locator('#hud-setting-position')).toHaveText('1.00 / 2.00 / 3.00');
  await expect(page.locator('#hud-setting-playing')).toHaveText('Paused');
  await expect(page.locator('#hud-iso')).toHaveText('400');
  await expect(page.locator('#hud-fov')).toHaveText('80°');
  await expect(page.locator('#hud-setting-density, #hud-setting-renderScale, #hud-setting-colorMode')).toHaveCount(0);
  await page.getByRole('button', { name: 'Press Space to take control', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__interfaceTest.calls)).toEqual(['look', 'flight']);
  await page.setViewportSize({ width: 375, height: 667 });
  const instrumentsBox = await page.locator('.hud-instruments').boundingBox();
  const keysBox = await page.locator('.hud-controls').boundingBox();
  expect(instrumentsBox!.y + instrumentsBox!.height).toBeLessThanOrEqual(keysBox!.y);
  expect(keysBox!.y + keysBox!.height).toBeLessThanOrEqual(667);
  expect(instrumentsBox!.x + instrumentsBox!.width).toBeLessThanOrEqual(375);
  expect(await page.locator('.hud-instruments').evaluate(element => {
    element.scrollTop = 100;
    return element.scrollHeight > element.clientHeight && element.scrollTop > 0;
  })).toBe(true);
  await page.evaluate(() => {
    const { state, ui } = (window as any).__interfaceTest;
    state.hudActive = false;
    state.introTitle = 'Inside the accelerating swirl.';
    state.introCaption = 'An orbit reveals inward flow and axial stretching. Linear time from t = 0.9990 to 0.9999; the preview stops before the singularity.';
    ui.update();
  });
  const promptBox = await page.locator('#intro-look-prompt').boundingBox();
  const captionBox = await page.locator('#intro-card').boundingBox();
  expect(promptBox!.y + promptBox!.height).toBeLessThanOrEqual(captionBox!.y);
  await toggle.click();
  await expect(toggle).toBeInViewport();
  await page.evaluate(() => {
    const { state, ui } = (window as any).__interfaceTest;
    state.introActive = false; ui.update();
  });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('#flight-controls')).toBeVisible();
  await page.locator('#screensaver').click();
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(toggle).toBeHidden();
  await page.evaluate(() => {
    const { state, ui } = (window as any).__interfaceTest;
    state.screensaver = false; ui.update();
  });
  await expect(toggle).toBeVisible();
  await expect(page.locator('#flight-controls')).toBeVisible();
});
