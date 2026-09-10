import { expect, test } from '@playwright/test';

// These are synthetic orientation events in an isolated page, not a claim of
// testing physical phone sensors or Safari's native permission dialog.
test.beforeEach(async ({ page }) => {
  await page.route('**/gyro-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Gyro steering fixture</title>' }));
  await page.goto('/gyro-fixture');
  await page.evaluate(async () => {
    const { createGyroSteering } = await import('/src/gyro.ts');
    const host = window as any;
    host.__permissionCalls = 0; host.__screenAngle = 0;
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: {
      requestPermission() { host.__permissionCalls++; return Promise.resolve('granted'); },
    } });
    Object.defineProperty(screen.orientation, 'angle', { configurable: true, get: () => host.__screenAngle });
    host.__createGyro = createGyroSteering; host.__gyro = createGyroSteering();
    host.__reading = (alpha: number | null, beta: number | null, gamma: number | null) => {
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha, beta, gamma }));
    };
    host.__settle = () => {
      let combined = [0, 0, 0, 1];
      for (let i = 0; i < 100; i++) {
        const q = host.__gyro.update(1 / 60);
        if (!q) continue;
        const [x,y,z,w] = combined, [a,b,c,d] = q;
        combined = [w*a+x*d+y*c-z*b, w*b-x*c+y*d+z*a, w*c+x*b-y*a+z*d, w*d-x*a-y*b-z*c];
      }
      return combined;
    };
  });
});

test('calibration does not snap and a stationary phone adds no rotation to the movie', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const host = window as any, gyro = host.__gyro;
    const callsBeforeEnable = host.__permissionCalls;
    const enabled = await gyro.enable();
    const waiting = gyro.status();
    host.__reading(237, 68, -31);
    const first = gyro.update(.016), settled = host.__settle();
    host.__reading(237, 68, -31);
    const still = gyro.update(.016);
    gyro.recalibrate(); host.__reading(54, -37, 22);
    const recalibrated = gyro.update(.016);
    host.__reading(null, 0, 0);
    const invalid = gyro.update(.016), invalidStatus = gyro.status();
    host.__reading(3, 4, 5);
    const resumed = gyro.update(.016);
    return { callsBeforeEnable, calls: host.__permissionCalls, enabled, waiting, first, settled, still, recalibrated, invalid, invalidStatus, resumed };
  });
  expect(report.callsBeforeEnable).toBe(0); expect(report.calls).toBe(1);
  expect(report.enabled).toBe(true); expect(report.waiting).toContain('Waiting');
  expect(report.first).toBeNull(); expect(report.still).toBeNull();
  expect(report.settled).toEqual([0, 0, 0, 1]);
  expect(report.recalibrated).toBeNull(); expect(report.invalid).toBeNull(); expect(report.resumed).toBeNull();
  expect(report.invalidStatus).toContain('Drag');
});

test('calibrated pitch, yaw and roll follow the W3C device axes and the shortest wrap', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const host = window as any; await host.__gyro.enable();
    return [
      { start: [0, 0, 0], end: [0, 30, 0], axis: 0, degrees: 30 },
      { start: [0, 0, 0], end: [0, 0, 30], axis: 1, degrees: 30 },
      { start: [0, 0, 0], end: [30, 0, 0], axis: 2, degrees: 30 },
      { start: [359, 0, 0], end: [1, 0, 0], axis: 2, degrees: 2 },
    ].map(example => {
      host.__gyro.recalibrate(); host.__reading(...example.start); host.__reading(...example.end);
      return { ...example, delta: host.__settle(), stationary: host.__gyro.update(.016) };
    });
  });
  for (const result of results) {
    expect(Math.hypot(...result.delta)).toBeCloseTo(1, 6);
    expect(result.delta[result.axis]).toBeCloseTo(Math.sin(result.degrees * Math.PI / 360), 5);
    expect(result.delta[3]).toBeCloseTo(Math.cos(result.degrees * Math.PI / 360), 5);
    for (let axis = 0; axis < 3; axis++) if (axis !== result.axis) expect(result.delta[axis]).toBeCloseTo(0, 6);
    expect(result.stationary).toBeNull();
  }
});

test('landscape correction rotates local axes and a screen rotation recalibrates without a jump', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const host = window as any; await host.__gyro.enable();
    host.__reading(0, 0, 0); host.__reading(0, 20, 0); host.__settle();
    host.__screenAngle = 90; screen.orientation.dispatchEvent(new Event('change'));
    host.__reading(0, 0, 0); const rotated = host.__gyro.update(.016);
    host.__reading(0, 20, 0); const landscape = host.__settle();
    Object.defineProperty(screen, 'orientation', { configurable: true, value: undefined });
    Object.defineProperty(window, 'orientation', { configurable: true, value: -90 });
    window.dispatchEvent(new Event('orientationchange')); host.__reading(0, 0, 0);
    const legacyCalibrated = host.__gyro.update(.016);
    host.__reading(0, 20, 0); const legacy = host.__settle();
    return { rotated, landscape, legacyCalibrated, legacy };
  });
  expect(report.rotated).toBeNull(); expect(report.legacyCalibrated).toBeNull();
  expect(report.landscape[0]).toBeCloseTo(0, 6);
  expect(report.landscape[1]).toBeCloseTo(Math.sin(10 * Math.PI / 180), 5);
  expect(report.legacy[1]).toBeCloseTo(-Math.sin(10 * Math.PI / 180), 5);
});

test('permission denial, unsupported sensors and disabling a pending request preserve drag fallback', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const host = window as any;
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: { requestPermission: async () => 'denied' } });
    const denied = await host.__gyro.enable(), deniedMessage = host.__gyro.status();
    let resolvePermission: (value: string) => void = () => {};
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: {
      requestPermission: () => new Promise(resolve => { resolvePermission = resolve; }),
    } });
    const pending = host.__gyro.enable(); host.__gyro.disable(); resolvePermission('granted');
    const canceled = await pending;
    host.__reading(0, 0, 0); host.__reading(0, 45, 0);
    const disabled = host.__gyro.update(.016);
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: undefined });
    const unsupported = host.__createGyro();
    const available = await unsupported.enable(), unavailableMessage = unsupported.status();
    unsupported.dispose();
    return { denied, deniedMessage, canceled, disabled, available, unavailableMessage };
  });
  expect(report.denied).toBe(false); expect(report.deniedMessage).toContain('denied');
  expect(report.deniedMessage).toContain('Drag'); expect(report.canceled).toBe(false); expect(report.disabled).toBeNull();
  expect(report.available).toBe(false); expect(report.unavailableMessage).toContain('Drag');
});

test('missing readings show a useful fallback without inventing motion', async ({ page }) => {
  await page.evaluate(() => (window as any).__gyro.enable());
  // Some browsers emit an all-null event when no physical sensor exists.
  await expect.poll(() => page.evaluate(() => (window as any).__gyro.status())).toMatch(/No gyro data received|Gyro data unavailable/);
  expect(await page.evaluate(() => (window as any).__gyro.status())).toContain('Drag');
  expect(await page.evaluate(() => (window as any).__gyro.update(.016))).toBeNull();
});
