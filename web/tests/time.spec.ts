import { expect, test } from '@playwright/test';

test('linear and logarithmic clocks have predictable rates and reach the finite endpoint', async ({ page }) => {
  await page.goto('/?field=core&debug=1');
  const result = await page.evaluate(async () => {
    const { advanceTime, timelinePosition, timeAtPosition } = await import('/src/time.ts');
    const end = .9999;
    let partitioned = .99;
    for (let i = 0; i < 20; i++) partitioned = advanceTime(partitioned, end, .01, .02, 'linear');
    return {
      linear: [.1, .99, .999].map(t => advanceTime(t, end, .01, .02, 'linear') - t),
      longFrame: advanceTime(.99, end, .2, .02, 'linear'), partitioned,
      endpoint: advanceTime(.999, end, 1, 10, 'linear'),
      log: [.1, .9].map(t => (1 - advanceTime(t, end, 1, 1, 'logarithmic')) / (1 - t)),
      roundtrip: ['linear', 'logarithmic'].map(mode => timeAtPosition(timelinePosition(.99, mode as any), mode as any)),
    };
  });
  for (const delta of result.linear) expect(delta).toBeCloseTo(.0002, 12);
  expect(result.longFrame).toBeCloseTo(.994, 12);
  expect(result.partitioned).toBeCloseTo(result.longFrame, 12);
  expect(result.endpoint).toBe(.9999);
  for (const ratio of result.log) expect(ratio).toBeCloseTo(.1, 12);
  for (const time of result.roundtrip) expect(time).toBeCloseTo(.99, 12);
});

test('actual viewer clock stays linear near the endpoint and speed/mode controls preserve position', async ({ page }) => {
  // Deterministic animation timestamps exercise main.ts, including its renderer
  // calls, without making the assertion depend on software-GPU frame rate.
  await page.addInitScript(() => {
    let now = 1000, id = 0;
    const pending = new Map<number, FrameRequestCallback>();
    Object.defineProperty(performance, 'now', { value: () => now });
    window.requestAnimationFrame = cb => { pending.set(++id, cb); return id; };
    window.cancelAnimationFrame = key => { pending.delete(key); };
    (window as any).__advanceFrame = (milliseconds: number) => {
      now += milliseconds;
      const callbacks = [...pending.values()]; pending.clear();
      callbacks.forEach(cb => cb(now));
    };
  });
  await page.goto('/?field=core&debug=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__observatory?.renderer))).toBe(true);
  const report = await page.evaluate(() => {
    const app = (window as any).__observatory, s = app.state;
    const tick = (window as any).__advanceFrame;
    const setInput = (id: string, value: string) => {
      const input = document.getElementById(id) as HTMLInputElement;
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const mode = document.getElementById('control-timeMode') as HTMLSelectElement;
    const defaults = { mode: s.timeMode, playing: s.playing };
    s.density = 10; s.renderScale = .25; s.time = .99; s.playing = true;
    setInput('control-playbackSpeed', '-2'); // .01 time/s
    tick(200); // used to be clamped to .05s AND slowed by the core budget
    const first = s.time;
    setInput('control-playbackSpeed', '-1'); // .1 time/s
    tick(20);
    const second = s.time;
    s.playing = false;
    mode.value = 'logarithmic'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    tick(200);
    const switched = { time: s.time, mode: s.timeMode, slider: Number((document.getElementById('simulation-time') as HTMLInputElement).value) };
    setInput('simulation-time', '2');
    const scrubbed = s.time;
    s.playing = true; setInput('control-playbackSpeed', '0'); tick(100);
    const logTime = s.time;
    mode.value = 'linear'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    setInput('control-playbackSpeed', '1'); tick(100);
    return { defaults, first, second, switched, scrubbed, logTime, end: s.time, paused: !s.playing,
      finite: app.renderer.audit().finiteParticles, glError: app.renderer.audit().glError };
  });
  expect(report.defaults).toEqual({ mode: 'linear', playing: false });
  expect(report.first).toBeCloseTo(.992, 12);
  expect(report.second).toBeCloseTo(.994, 12);
  expect(report.switched.time).toBeCloseTo(report.second, 12);
  expect(report.switched.mode).toBe('logarithmic');
  expect(report.switched.slider).toBeCloseTo(-Math.log10(1 - report.second), 10);
  expect(report.scrubbed).toBeCloseTo(.99, 12);
  expect(report.logTime).toBeCloseTo(1 - .01 * 10 ** (-.1), 12);
  expect(report.end).toBe(.9999);
  expect(report.paused).toBe(true);
  expect(report.finite).toBe(true);
  expect(report.glError).toBe(0);
});
