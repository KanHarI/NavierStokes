import { expect, test } from '@playwright/test';

// Exercise the real app clock, navigation and UI without scheduling GPU work.
// The reference feature changes these layers; field/rendering checks are separate.
test.beforeEach(async ({ page }) => {
  await page.route('**/src/renderer.ts', route => route.fulfill({
    contentType: 'text/javascript', body: `
      export class Renderer {
        hasPendingFrame = false;
        gl = { isContextLost: () => false };
        constructor(canvas, state, field) { this.field = field; this.state = state; }
        render() { return true; }
        finishFrame() {}
        reseed() {}
        cancelFrame() {}
        dispose() {}
      }`,
  }));
});

const view = (state: any) => ({ ship: state.ship, near: state.near, far: state.far,
  focus: state.focus, fov: state.fov, exposure: state.exposure, density: state.density,
  blur: state.blur, shellFade: state.shellFade, shellBokeh: state.shellBokeh,
  renderScale: state.renderScale, colorMode: state.colorMode });

test('reference preserves a chosen view through playback and scrubbing, then unlocks paused', async ({ page }) => {
  await page.goto('/?intro=0');
  await expect(page.locator('#startup-loader')).toBeHidden();
  await page.evaluate(() => {
    const state = (window as any).__observatory.state;
    Object.assign(state, { time: .1, playbackSpeed: .2, exposure: -1, fov: 77,
      near: 1.4, far: 5.1, focus: 3.2, density: 33, timeMode: 'logarithmic', independentDust: true });
    state.ship.position = [.3, -.4, .2]; state.ship.scale = .12;
  });
  const before = view(await page.evaluate(() => (window as any).__observatory.state));
  await page.locator('#reference-view').click();
  await expect(page.locator('#reference-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#control-exposure')).toBeDisabled();
  await expect(page.locator('#control-scale')).toBeDisabled();
  await expect(page.locator('#control-density')).toBeDisabled();
  await expect(page.locator('#control-timeMode')).toBeDisabled();
  await expect(page.locator('#control-independentDust')).toBeDisabled();
  await expect(page.locator('#control-playbackSpeed')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.time)).toBeGreaterThan(.2);
  let state = await page.evaluate(() => (window as any).__observatory.state);
  expect(view(state)).toEqual(before);
  expect(state).toMatchObject({ introActive: false, referenceView: true, timeMode: 'linear', independentDust: false });

  await page.locator('#simulation-time').fill('0.4');
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.playing)).toBe(false);
  state = await page.evaluate(() => (window as any).__observatory.state);
  expect(state.time).toBeCloseTo(.4, 8);
  expect(view(state)).toEqual(before);
  expect(state.referenceView).toBe(true);

  await page.locator('#reference-view').click();
  await expect(page.locator('#control-exposure')).toBeEnabled();
  await expect(page.locator('#control-scale')).toBeEnabled();
  await expect(page.locator('#control-density')).toBeEnabled();
  await expect(page.locator('#control-timeMode')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__observatory.state.playing)).toBe(false);

  // Desktop pilots can lock their chosen manual view without Escape (which
  // intentionally returns to automatic viewing and chooses a new camera).
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#space')!;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    document.dispatchEvent(new Event('pointerlockchange'));
    (window as any).__observatory.state.hudActive = true;
    canvas.focus();
  });
  await page.keyboard.press('v');
  await expect(page.locator('#hud-mode')).toHaveText('Reference · framing locked');
  await page.keyboard.press('v');
  await expect(page.locator('#hud-mode')).toHaveText('Manual flight');
  expect(await page.evaluate(() => (window as any).__observatory.state.playing)).toBe(false);
});

test('capturing a cinematic view stops procedural changes and pauses at the finite endpoint', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#startup-loader')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.locator('#reference-view').click();
  const before = view(await page.evaluate(() => (window as any).__observatory.state));
  await page.evaluate(() => { (window as any).__observatory.state.playbackSpeed = 10; });
  await expect.poll(() => page.evaluate(() => {
    const s = (window as any).__observatory.state; return s.time === s.timeMax && !s.playing;
  })).toBe(true);
  expect(view(await page.evaluate(() => (window as any).__observatory.state))).toEqual(before);
  await expect(page.locator('#viewer-status')).toContainText('Dataset endpoint');
  await page.locator('#replay-intro').click();
  await expect.poll(() => page.evaluate(() => {
    const s = (window as any).__observatory.state; return s.introActive && !s.referenceView;
  })).toBe(true);
});

test('mobile settings expose reference playback and keep radar readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(pointer: coarse)'
      ? Object.defineProperty(original(query), 'matches', { value: true }) : original(query);
  });
  await page.goto('/?intro=0');
  await expect(page.locator('#startup-loader')).toBeHidden();
  await page.locator('#enter-flight').click();
  await page.locator('#touch-settings').click();
  await page.locator('#reference-settings').click();
  await expect(page.locator('#reference-description')).toContainText('Reference locked');
  await page.locator('#touch-close').click();
  await expect(page.locator('#hud-range')).toBeVisible();
  await expect(page.locator('.touch-hint')).toContainText('framing locked');
  await page.locator('#touch-settings').click();
  await page.locator('#reference-settings').click();
  await expect(page.locator('#control-exposure')).toBeEnabled();
  await page.locator('#touch-auto').click();
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
});
