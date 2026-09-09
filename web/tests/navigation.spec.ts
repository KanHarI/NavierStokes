import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Isolate navigation from the running viewer and its animation loop.
  await page.route('**/navigation-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><canvas></canvas><input aria-label="Editing field"><button>UI button</button>',
  }));
  await page.goto('/navigation-fixture');
});

test('normalizes orientation and remains a finite rotation after repeated local mouse and roll input', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState();
    state.ship.orientation = [1, 2, 3, 4];
    const canvas = document.querySelector('canvas')!;
    const navigation = createNavigation(canvas, state);
    const initialNorm = Math.hypot(...state.ship.orientation);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    document.dispatchEvent(new Event('pointerlockchange'));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    for (let i = 0; i < 4000; i++) {
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: 7, movementY: -3 }));
      navigation.update(1 / 60);
    }
    const finalOrientation = [...state.ship.orientation];
    delete (document as any).pointerLockElement;
    navigation.dispose();
    return { initialNorm, finalOrientation };
  });
  expect(result.initialNorm).toBeCloseTo(1, 12);
  expect(result.finalOrientation.every(Number.isFinite)).toBe(true);
  expect(Math.hypot(...result.finalOrientation)).toBeCloseTo(1, 12);
});

test('focus loss and pointer release clear held flight keys, and disposal removes handlers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState();
    state.ship.position = [0, 0, 0];
    state.ship.orientation = [0, 0, 0, 1];
    const canvas = document.querySelector('canvas')!;
    const navigation = createNavigation(canvas, state);
    const key = (code: string) => document.dispatchEvent(new KeyboardEvent('keydown', { code }));
    key('KeyW');
    navigation.update(.1);
    const unlockedDistance = Math.hypot(...state.ship.position);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    document.dispatchEvent(new Event('pointerlockchange'));
    key('KeyW');
    navigation.update(.1);
    const moved = [...state.ship.position];
    window.dispatchEvent(new Event('blur'));
    navigation.update(.1);
    const afterBlur = [...state.ship.position];
    key('KeyW');
    delete (document as any).pointerLockElement;
    document.dispatchEvent(new Event('pointerlockchange'));
    navigation.update(.1);
    const afterRelease = [...state.ship.position];
    // Re-entering flight must not resume the key that was held at release.
    state.pointerLocked = true;
    navigation.update(.1);
    const afterReenter = [...state.ship.position];
    navigation.dispose();
    state.pointerLocked = true;
    key('KeyW');
    navigation.update(.1);
    return { unlockedDistance, moved, afterBlur, afterRelease, afterReenter, afterDispose: state.ship.position };
  });
  expect(result.unlockedDistance).toBe(0);
  expect(Math.hypot(...result.moved)).toBeGreaterThan(0);
  expect(result.afterBlur).toEqual(result.moved);
  expect(result.afterRelease).toEqual(result.moved);
  expect(result.afterReenter).toEqual(result.moved);
  expect(result.afterDispose).toEqual(result.moved);
});

test('Space respects editable controls, key repeat, and scientific data availability', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState();
    state.loading = false;
    state.flowAvailable = true;
    state.playing = false;
    const navigation = createNavigation(document.querySelector('canvas')!, state);
    const space = (target: EventTarget = document, repeat = false) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, repeat }));
    space(document.querySelector('input')!);
    space(document.querySelector('button')!);
    const afterEditing = state.playing;
    space();
    const afterPress = state.playing;
    space(document, true);
    const afterRepeat = state.playing;
    state.flowAvailable = false;
    space();
    const afterUnavailable = state.playing;
    state.flowAvailable = true;
    state.loading = true;
    space();
    const afterLoading = state.playing;
    navigation.dispose();
    return { afterEditing, afterPress, afterRepeat, afterUnavailable, afterLoading };
  });
  expect(result).toEqual({ afterEditing: false, afterPress: true, afterRepeat: true, afterUnavailable: true, afterLoading: true });
});
