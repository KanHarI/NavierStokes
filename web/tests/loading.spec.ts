import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('the first HTML already shows drifting monochrome snow before JavaScript runs', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#startup-loader')).toBeVisible();
  await expect(page.locator('#startup-stage')).toHaveText('Loading…');
  await expect(page.getByRole('status')).toHaveText('Loading…');
  const snow = page.locator('.startup-snow').last();
  const appearance = await snow.evaluate(element => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, texture: style.backgroundImage, transform: style.transform,
      background: getComputedStyle(document.querySelector('#startup-loader')!).backgroundColor };
  });
  expect(appearance.background).toBe('rgb(0, 0, 0)');
  expect(appearance.texture).toContain('data:image/svg+xml');
  expect(appearance.animation).toBe('startup-drift');
  await expect.poll(() => snow.evaluate(element => getComputedStyle(element).transform)).not.toBe(appearance.transform);
  await page.screenshot({ path: info.outputPath('loading-before-javascript.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(snow).toHaveCSS('animation-name', 'none');
  await page.locator('#startup-loader').evaluate(element => { (element as HTMLElement).hidden = true; });
  await expect(page.locator('#startup-loader')).toBeHidden();
});
