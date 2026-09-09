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
    });
    Object.assign(window, { __interfaceTest: { state, ui, calls } });
  });
  const toggle = page.locator('#toggle-interface');
  await expect(page.locator('#intro-card')).toBeVisible();
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
  await page.setViewportSize({ width: 375, height: 667 });
  await toggle.click();
  await expect(toggle).toBeInViewport();
  await page.evaluate(() => {
    const { state, ui } = (window as any).__interfaceTest;
    state.introActive = false; ui.update();
  });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('#flight-controls')).toBeVisible();
});
