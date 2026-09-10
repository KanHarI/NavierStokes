import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Isolate navigation from the running viewer and its animation loop.
  await page.route('**/navigation-fixture?field=exterior', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><canvas></canvas><input aria-label="Editing field"><button>UI button</button>',
  }));
  await page.goto('/navigation-fixture?field=exterior');
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
    key('ShiftLeft');
    const boosting = state.boosting;
    navigation.update(.1);
    const moved = [...state.ship.position];
    window.dispatchEvent(new Event('blur'));
    const boostAfterBlur = state.boosting;
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
    return { unlockedDistance, moved, afterBlur, afterRelease, afterReenter, afterDispose: state.ship.position, boosting, boostAfterBlur };
  });
  expect(result.unlockedDistance).toBe(0);
  expect(Math.hypot(...result.moved)).toBeGreaterThan(0);
  expect(result.afterBlur).toEqual(result.moved);
  expect(result.afterRelease).toEqual(result.moved);
  expect(result.afterReenter).toEqual(result.moved);
  expect(result.afterDispose).toEqual(result.moved);
  expect(result.boosting).toBe(true);
  expect(result.boostAfterBlur).toBe(false);
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

test('movie steering adds a local pose without touching the path, clock, or optics, and resets for a new clip', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState();
    Object.assign(state, { introActive: true, time: .42, playing: true, flowAvailable: true, loading: false });
    const canvas = document.querySelector('canvas')!;
    const navigation = createNavigation(canvas, state);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    document.dispatchEvent(new Event('pointerlockchange'));
    const before = JSON.stringify(state);
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 120, movementY: -75 }));
    for (const code of ['KeyW', 'KeyX', 'KeyQ', 'Space']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { code }));
    }
    navigation.update(.1);
    const after = JSON.stringify(state);
    const firstBase: [number, number, number, number] = [0, 0, 0, 1];
    const secondBase: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const first = navigation.applyIntroOrientation(firstBase);
    const second = navigation.applyIntroOrientation(secondBase);
    const base = { position: [1, 2, 3] as [number, number, number], orientation: secondBase, scale: .25 };
    const steeredPose = navigation.applyIntroPose(base);
    const baseAfter = JSON.stringify(base);
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value*b[i], 0);
    delete (document as any).pointerLockElement;
    document.dispatchEvent(new Event('pointerlockchange'));
    const afterRelease = navigation.applyIntroOrientation(secondBase);
    navigation.resetIntroLook();
    const reset = navigation.applyIntroOrientation(secondBase);
    const resetPose = navigation.applyIntroPose(base);
    state.pointerLocked = true;
    navigation.update(.1);
    const noHeldKeysAfterReset = navigation.applyIntroPose(base);
    navigation.dispose();
    return { before, after, first, second, afterRelease, reset, secondBase, base, baseAfter,
      steeredPose, resetPose, noHeldKeysAfterReset,
      firstAngle: dot(firstBase, first), secondAngle: dot(secondBase, second) };
  });
  expect(report.after).toBe(report.before);
  expect(report.first).not.toEqual([0, 0, 0, 1]);
  expect(report.second).not.toEqual(report.secondBase);
  expect(report.firstAngle).toBeCloseTo(report.secondAngle, 12);
  expect(Math.hypot(...report.first)).toBeCloseTo(1, 12);
  expect(Math.hypot(...report.second)).toBeCloseTo(1, 12);
  expect(report.afterRelease).toEqual(report.second);
  report.reset.forEach((value, index) => expect(value).toBeCloseTo(report.secondBase[index], 12));
  expect(report.baseAfter).toBe(JSON.stringify(report.base));
  expect(report.steeredPose.position).not.toEqual(report.base.position);
  expect(report.steeredPose.scale).toBe(report.base.scale);
  expect(report.steeredPose.orientation).toEqual(report.second);
  expect(report.resetPose.position).toEqual(report.base.position);
  expect(report.resetPose.scale).toEqual(report.base.scale);
  expect(report.noHeldKeysAfterReset).toEqual(report.resetPose);
});

test('movie travel follows the camera, normalizes diagonal movement, and scales with magnification', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState();
    state.introActive = true; state.pointerLocked = true;
    const navigation = createNavigation(document.querySelector('canvas')!, state);
    const base = { position: [0, 0, 0] as [number, number, number],
      orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number], scale: 2 };
    const key = (code: string) => document.dispatchEvent(new KeyboardEvent('keydown', { code }));
    key('KeyW'); navigation.update(.1);
    const forward = navigation.applyIntroPose(base);
    navigation.resetIntroLook();
    key('KeyW'); key('KeyX'); navigation.update(.1);
    const radarTravel = navigation.applyIntroPose(base);
    const radar = navigation.applyIntroOptics({ near: 2, far: 4, focus: 3, shellFade: 1, shellBokeh: 24, blur: 6, exposure: 0, fov: 65 });
    navigation.resetIntroLook();
    key('KeyW'); key('KeyD'); navigation.update(.1);
    const diagonal = navigation.applyIntroPose(base);
    const enlarged = navigation.applyIntroPose({ ...base, scale: 4 });
    navigation.resetIntroLook();
    key('ArrowUp'); navigation.update(.1);
    const vertical = navigation.applyIntroPose(base);
    navigation.dispose();
    return { forward, diagonal, enlarged, vertical, radarTravel, radar };
  });
  expect(report.forward.position[0]).toBeLessThan(0);
  expect(Math.abs(report.forward.position[2])).toBeLessThan(1e-12);
  expect(Math.hypot(...report.diagonal.position)).toBeCloseTo(Math.hypot(...report.forward.position), 12);
  expect(Math.hypot(...report.enlarged.position)).toBeCloseTo(2 * Math.hypot(...report.diagonal.position), 12);
  expect(report.vertical.position[1]).toBeGreaterThan(0);
  expect(report.radarTravel).toEqual(report.forward);
  expect(report.radar.near).toBeCloseTo(2 * Math.exp(.1), 12);
  expect(report.radar.far).toBeCloseTo(4 * Math.exp(.1), 12);
  expect(report.radar.focus).toBeCloseTo(3 * Math.exp(.1), 12);
  expect(report.radar.shellFade).toBeCloseTo(Math.exp(.1), 12);
});

test('optical keys adjust bounded movie overrides, reset between clips, and work in manual flight', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState();
    state.introActive = true; state.pointerLocked = true; state.playing = true;
    const navigation = createNavigation(document.querySelector('canvas')!, state);
    const base = { near: 2, far: 4, focus: 3, blur: 6, shellBokeh: 24, fov: 65, exposure: 0, shellFade: 1 };
    const before = JSON.stringify(state);
    const key = (code: string, target: EventTarget = document) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    key('Equal', document.querySelector('input')!);
    navigation.update(.1);
    const editing = navigation.applyIntroOptics(base);
    for (const code of ['Equal', 'BracketRight', 'Digit2', 'Digit4', 'Digit6']) key(code);
    navigation.update(.1);
    const adjusted = navigation.applyIntroOptics(base);
    for (let i = 0; i < 400; i++) navigation.update(.1);
    const bounded = navigation.applyIntroOptics(base);
    const after = JSON.stringify(state);
    navigation.resetIntroLook(); navigation.update(.1);
    const reset = navigation.applyIntroOptics(base);
    state.introActive = false;
    key('Minus'); key('BracketLeft'); key('Digit1'); key('Digit3'); key('Digit5');
    navigation.update(.1);
    const manual = { exposure: state.exposure, fov: state.fov, near: state.near, far: state.far,
      focus: state.focus, blur: state.blur, shellBokeh: state.shellBokeh, playing: state.playing };
    navigation.dispose();
    return { base, editing, before, after, adjusted, bounded, reset, manual };
  });
  expect(report.editing).toEqual(report.base);
  expect(report.after).toBe(report.before);
  expect(report.adjusted.exposure).toBeCloseTo(.1, 12);
  expect(report.adjusted.fov).toBe(67);
  expect(report.adjusted.near).toBeLessThan(report.base.near);
  expect(report.adjusted.far).toBeGreaterThan(report.base.far);
  expect(report.adjusted.focus).toBeCloseTo(3.08, 12);
  expect(report.adjusted.blur).toBeCloseTo(6.8, 12);
  expect(report.adjusted.shellBokeh).toBeCloseTo(25.28, 12);
  expect(report.bounded).toEqual({ ...report.base, exposure: 8, fov: 120, near: .05, far: 8, focus: 8, blur: 30, shellBokeh: 48 });
  expect(report.reset).toEqual(report.base);
  expect(report.manual.exposure).toBeCloseTo(-.1, 12);
  expect(report.manual.fov).toBe(63);
  expect(report.manual.near).toBeGreaterThan(report.base.near);
  expect(report.manual.far).toBeLessThan(report.base.far);
  expect(report.manual.focus).toBeCloseTo(2.92, 12);
  expect(report.manual.blur).toBeCloseTo(5.2, 12);
  expect(report.manual.shellBokeh).toBeCloseTo(22.72, 12);
  expect(report.manual.playing).toBe(true);
});

test('movie bokeh responds immediately when reversing from either limit', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { createNavigation } = await import('/src/navigation.ts');
    const { initialState } = await import('/src/types.ts');
    const state = initialState(); state.introActive = true; state.pointerLocked = true;
    const navigation = createNavigation(document.querySelector('canvas')!, state);
    const base = { near: 2, far: 4, focus: 3, blur: 20, shellBokeh: 20, fov: 65, exposure: 0, shellFade: 1 };
    const hold = (code: string, frames: number) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code }));
      let result = base;
      for (let i = 0; i < frames; i++) { navigation.update(.1); result = navigation.applyIntroOptics(base); }
      document.dispatchEvent(new KeyboardEvent('keyup', { code }));
      return result;
    };
    const maximum = hold('Digit6', 100), less = hold('Digit5', 1);
    const minimum = hold('Digit5', 100), more = hold('Digit6', 1);
    navigation.resetIntroLook(); const reset = navigation.applyIntroOptics(base); navigation.dispose();
    return { maximum, less, minimum, more, reset, base };
  });
  expect(report.maximum.blur).toBe(30); expect(report.maximum.shellBokeh).toBe(48);
  expect(report.less.shellBokeh).toBeLessThan(report.maximum.shellBokeh);
  expect(report.minimum.blur).toBe(0); expect(report.minimum.shellBokeh).toBe(0);
  expect(report.more.blur).toBeGreaterThan(report.minimum.blur);
  expect(report.reset).toEqual(report.base);
});
