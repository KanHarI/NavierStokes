import { expect, test, type Page } from '@playwright/test';

async function load(page: Page, query = '?debug=1') {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => {
    const app = (window as any).__observatory;
    return app && !app.state.loading && app.renderer;
  });
  // Keep the real clock and choreography intact while reducing software-GPU
  // work. These are ordinary quality controls, not a replacement frame clock.
  await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.density = 12;
    s.renderScale = .5;
  });
}

async function replay(page: Page) {
  await page.getByRole('button', { name: /replay sequence/i }).click();
  await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    s.density = 12;
    s.renderScale = .5;
  });
}

test('the arriving viewer plays a complete generated clip and starts a fresh one in real time', async ({ page }, info) => {
  test.setTimeout(75_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.keyboard.press('Escape');
  await replay(page);
  await page.evaluate(() => {
    const audit = { start: performance.now(), observations: [] as any[] };
    (window as any).__introAudit = audit;
    let lastSample = -Infinity, previousShot = -1;
    const record = () => {
      const s = (window as any).__observatory.state, elapsed = performance.now()-audit.start;
      // Each generated clip chooses its own density. Keep only test rendering
      // quality reduced, including after its genuine per-clip reset.
      s.density = 12;
      if (s.introShot !== previousShot || elapsed-lastSample >= 100) {
        audit.observations.push({ elapsed, shot: s.introShot, duration: s.introDuration,
          active: s.introActive, phase: s.introProgress, time: s.time, color: s.colorMode });
        lastSample = elapsed; previousShot = s.introShot;
      }
      if (elapsed < 45_000 && s.introActive) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  const capture = async (name: string) => {
    const result = await page.evaluate(() => {
      const app = (window as any).__observatory, s = app.state;
      return { shot: s.introShot, duration: s.introDuration, phase: s.introProgress,
        time: s.time, minimum: s.timeMin, maximum: s.timeMax, active: s.introActive,
        title: s.introTitle, position: s.ship.position, orientation: s.ship.orientation,
        scale: s.ship.scale, color: s.colorMode, audit: app.renderer.audit() };
    });
    expect(result.active).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(5);
    expect(result.duration).toBeLessThanOrEqual(30);
    expect(result.time).toBeGreaterThanOrEqual(result.minimum);
    expect(result.time).toBeLessThanOrEqual(result.maximum);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.scale).toBeGreaterThan(0);
    expect([...result.position, ...result.orientation, result.scale].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...result.orientation)).toBeCloseTo(1, 5);
    expect(result.color).toBe('white');
    expect(result.audit.finiteParticles).toBe(true);
    expect(result.audit.glError).toBe(0);
    expect(Number.isFinite(result.audit.lightInput)).toBe(true);
    expect(Number.isFinite(result.audit.lightOutput)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
    return result;
  };
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.introShot === 0 && s.introProgress >= .3;
  }, null, { timeout: 35_000 });
  const first = await capture('intro-first-clip');
  // Do not replace the browser clock: this waits for the genuine endpoint and
  // its fade-to-black restart, however long this generated clip happens to be.
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.introShot === 0 && s.time === s.timeMax;
  }, null, { timeout: 35_000 });
  const endpoint = await capture('intro-first-endpoint');
  await page.waitForFunction(() => {
    const s = (window as any).__observatory.state;
    return s.introShot === 1 && s.introProgress >= .12;
  }, null, { timeout: 35_000 });
  const next = await capture('intro-next-clip');
  expect(first.shot).toBe(0); expect(endpoint.shot).toBe(0); expect(next.shot).toBe(1);
  expect(first.audit.lightInput).toBeGreaterThan(0);
  expect(next.audit.lightInput).toBeGreaterThan(0);
  const report = await page.evaluate(() => (window as any).__introAudit);
  expect(report.observations.some((value: any) => value.shot === 0 && value.time === endpoint.maximum)).toBe(true);
  const transition = report.observations.find((value: any) => value.shot === 1);
  expect(transition.elapsed).toBeGreaterThanOrEqual((first.duration-.35)*1000);
  expect(report.observations.every((value: any) => value.active && value.color === 'white')).toBe(true);
  await info.attach('generated-intro-audit', { body: JSON.stringify({ ...report, captures: [first, endpoint, next] }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

async function moduleHost(page: Page) {
  await page.route('**/intro-module-host', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Procedural intro contract</title>',
  }));
  await page.goto('/intro-module-host');
}

test('generated clips are seeded, diverse, and optically well formed', async ({ page }) => {
  await moduleHost(page);
  const report = await page.evaluate(async () => {
    const { generateIntroClip, createIntroDirector } = await import('/src/intro.ts');
    return [1, 7, 29, 1234, 65535, 0x12345678, 0xabcdef01, 0xffffffff].map(seed => {
      const first = createIntroDirector(seed), second = createIntroDirector(seed);
      let start = 0;
      const clips = Array.from({ length: 16 }, (_, index) => {
        const config = generateIntroClip(seed, index), repeated = generateIntroClip(seed, index);
        const elapsed = start + .5*config.duration;
        const sample = first.sample(elapsed), duplicate = second.sample(elapsed);
        start += config.duration;
        return { config, repeated, sample, duplicate };
      });
      return { seed, clips };
    });
  });
  const samples = report.flatMap(group => group.clips);
  expect(new Set(samples.map(value => value.config.duration.toFixed(6))).size).toBeGreaterThan(80);
  expect(new Set(samples.map(value => value.sample.fov.toFixed(5))).size).toBeGreaterThan(80);
  expect(new Set(samples.map(value => value.sample.position.map((x: number) => x.toFixed(5)).join(','))).size).toBeGreaterThan(100);
  for (const { config, repeated, sample, duplicate } of samples) {
    expect(config).toEqual(repeated); expect(sample).toEqual(duplicate);
    expect(config.duration).toBeGreaterThanOrEqual(5); expect(config.duration).toBeLessThanOrEqual(30);
    expect(sample.shot).toBe(config.index);
    expect(sample.duration).toBe(config.duration);
    expect(sample.near).toBeGreaterThanOrEqual(0);
    expect(sample.focus).toBeGreaterThan(sample.near);
    expect(sample.focus).toBeLessThan(sample.far);
    expect(sample.shellFade).toBeGreaterThan(0);
    expect(sample.blur).toBeGreaterThanOrEqual(0); expect(sample.shellBokeh).toBeGreaterThanOrEqual(0);
    expect(sample.fov).toBeGreaterThan(10); expect(sample.fov).toBeLessThan(120);
    expect(sample.scale).toBeGreaterThan(0); expect(sample.perspective).toBeGreaterThan(0);
    expect([...sample.position, ...sample.orientation, sample.scale, sample.exposure, sample.perspective].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...sample.orientation)).toBeCloseTo(1, 10);
    const [x, y, z, w] = sample.orientation;
    const forward = [-2*(x*z+w*y), 2*(w*x-y*z), 2*(x*x+y*y)-1];
    const distance = Math.hypot(...sample.position);
    const alignment = forward.reduce((sum, value, i) => sum-value*sample.position[i]/distance, 0);
    expect(alignment).toBeCloseTo(1, 10);
    // The focused origin and shell share the same perspective-distance change.
    expect(distance/sample.scale).toBeCloseTo(sample.focus, 9);
  }
});

test('every generated clip advances physical time linearly and resets only at black', async ({ page }) => {
  await moduleHost(page);
  const report = await page.evaluate(async () => {
    const { generateIntroClip, createIntroDirector } = await import('/src/intro.ts');
    return [19, 73, 2026].flatMap(seed => {
      const director = createIntroDirector(seed);
      let start = 0;
      return Array.from({ length: 12 }, (_, index) => {
        const config = generateIntroClip(seed, index), duration = config.duration, play = duration-1;
        const at = (local: number) => director.sample(start+local, .2, .9999);
        const result = { index, duration, begin: at(1e-9),
          first: at(.35+.25*play), middle: at(.35+.5*play), last: at(.35+.75*play),
          endpoint: at(duration-.5), beforeNext: at(duration-1e-6), next: at(duration+1e-9) };
        start += duration;
        return result;
      });
    });
  });
  for (const clip of report) {
    const { begin, first, middle, last, endpoint, beforeNext, next } = clip;
    expect(begin.shot).toBe(clip.index);
    expect(begin.startTime).toBeGreaterThanOrEqual(.2);
    expect(begin.startTime).toBeLessThan(.9999);
    if (clip.index === 0) expect(begin.startTime).toBe(.2);
    expect(begin.time).toBeCloseTo(begin.startTime, 10);
    expect(first.time).toBeGreaterThan(begin.startTime);
    expect(last.time-middle.time).toBeCloseTo(middle.time-first.time, 10);
    expect((last.time-first.time)/(.5*(clip.duration-1))).toBeCloseTo(middle.playbackSpeed, 10);
    expect(endpoint.time).toBe(.9999); expect(beforeNext.time).toBe(.9999);
    expect(begin.opacity).toBeLessThan(1e-6); expect(beforeNext.opacity).toBeLessThan(1e-6);
    expect(middle.opacity).toBe(1); expect(next.opacity).toBeLessThan(1e-6);
    expect(next.shot).toBe(clip.index+1);
    expect(next.time).toBeCloseTo(next.startTime, 10);
  }
});

test('manual input preserves the current view, and exploration and replay remain available', async ({ page }) => {
  await load(page);
  const preserved = await page.evaluate(() => {
    const s = (window as any).__observatory.state;
    const snapshot = () => ({ time: s.time, position: [...s.ship.position], orientation: [...s.ship.orientation], scale: s.ship.scale });
    const before = snapshot();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    return { before, after: snapshot(), active: s.introActive };
  });
  expect(preserved.active).toBe(false);
  expect(preserved.after).toEqual(preserved.before);
  await replay(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  await replay(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.locator('#control-fov').evaluate(element => {
    const input = element as HTMLInputElement;
    input.value = '80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  expect(await page.evaluate(() => (window as any).__observatory.state.fov)).toBe(80);
  await replay(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.getByRole('button', { name: /explore the flow/i }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  await page.keyboard.press('Escape');
});

test('reduced motion and explicit manual URLs do not autoplay the camera', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page);
  expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const query of ['?debug=1&intro=0', '?debug=1&field=core', '?debug=1&field=exterior']) {
    await load(page, query);
    expect(await page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(false);
  }
});

test('directional exposure preserves integrated particle light', async ({ page }) => {
  await load(page, '?field=exterior&debug=1');
  const report = await page.evaluate(() => {
    const r = (window as any).__observatory.renderer;
    return [r.auditGaussian(0), r.auditGaussian(.5)];
  });
  for (const audit of report) {
    expect(audit.glError).toBe(0);
    for (const sample of audit.cases) expect(Math.abs(sample.light/audit.expectedLight-1)).toBeLessThan(.02);
  }
});
