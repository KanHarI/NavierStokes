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

test('the default cinematic sequence actually plays four views and loops in real time', async ({ page }, info) => {
  test.setTimeout(65_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page);
  await expect.poll(() => page.evaluate(() => (window as any).__observatory.state.introActive)).toBe(true);
  await page.keyboard.press('Escape');
  await replay(page);
  const start = await page.evaluate(() => {
    const audit = { start: performance.now(), observations: [] as any[] };
    (window as any).__introAudit = audit;
    let previousShot = -1, lastSample = -Infinity;
    const record = () => {
      const s = (window as any).__observatory.state;
      const elapsed = performance.now() - audit.start;
      if (s.introShot !== previousShot || elapsed - lastSample >= 100) {
        audit.observations.push({ elapsed, shot: s.introShot, active: s.introActive,
          time: s.time, title: s.introTitle, scale: s.ship.scale, color: s.colorMode });
        previousShot = s.introShot;
        lastSample = elapsed;
      }
      if (elapsed < 24_000) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
    return audit.start;
  });
  const captures = [];
  for (const [shot, second] of [2, 8, 14, 20].entries()) {
    await page.waitForFunction(({ start, second }) => performance.now() - start >= second * 1000,
      { start, second });
    const capture = await page.evaluate(() => {
      const app = (window as any).__observatory, s = app.state;
      return { shot: s.introShot, time: s.time, minimum: s.timeMin, maximum: s.timeMax,
        active: s.introActive, title: s.introTitle, position: s.ship.position,
        orientation: s.ship.orientation, scale: s.ship.scale, color: s.colorMode,
        audit: app.renderer.audit() };
    });
    expect(capture.shot).toBe(shot);
    expect(capture.active).toBe(true);
    expect(capture.title.length).toBeGreaterThan(0);
    expect(capture.time).toBeGreaterThanOrEqual(capture.minimum);
    expect(capture.time).toBeLessThanOrEqual(capture.maximum);
    expect(capture.scale).toBeGreaterThan(0);
    expect([...capture.position, ...capture.orientation, capture.scale].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...capture.orientation)).toBeCloseTo(1, 5);
    expect(capture.color).toBe('white');
    expect(capture.audit.finiteParticles).toBe(true);
    expect(capture.audit.glError).toBe(0);
    expect(Number.isFinite(capture.audit.lightInput)).toBe(true);
    expect(Number.isFinite(capture.audit.lightOutput)).toBe(true);
    await page.screenshot({ path: info.outputPath(`intro-view-${shot + 1}.png`) });
    captures.push({ shot: capture.shot, time: capture.time, scale: capture.scale,
      title: capture.title, lightInput: capture.audit.lightInput });
  }
  await page.waitForFunction(start => {
    const s = (window as any).__observatory.state;
    return performance.now() - start >= 22_250 && s.introActive && s.introShot === 0;
  }, start);
  const report = await page.evaluate(() => {
    const audit = (window as any).__introAudit;
    const shots = audit.observations.map((p: any) => p.shot)
      .filter((shot: number, index: number, values: number[]) => index === 0 || shot !== values[index - 1]);
    return { elapsed: performance.now() - audit.start, shots, observations: audit.observations,
      white: (window as any).__observatory.state.colorMode === 'white' };
  });
  expect(report.elapsed).toBeGreaterThanOrEqual(22_000);
  expect(report.shots.slice(0, 5)).toEqual([0, 1, 2, 3, 0]);
  expect(report.white).toBe(true);
  await expect(page.locator('#intro-rate')).toHaveText('1/2× speed');
  expect(await page.evaluate(() => (window as any).__observatory.state.introRate)).toBe(.5);
  expect(captures.filter(capture => capture.lightInput > 0).length).toBeGreaterThanOrEqual(3);
  expect(new Set(captures.map(capture => capture.title)).size).toBe(4);
  for (let i = 1; i < captures.length; i++) expect(captures[i].scale).toBeLessThan(captures[i - 1].scale);
  await info.attach('real-time-intro-audit', { body: JSON.stringify({ ...report, captures }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
  await page.keyboard.press('Escape');
  await replay(page);
  await expect(page.locator('#intro-rate')).toHaveText('1× speed');
  expect(await page.evaluate(() => (window as any).__observatory.state.introRate)).toBe(1);
});

test('each complete four-view cycle halves every part of the choreography again', async ({ page }) => {
  await page.route('**/intro-module-host', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Intro cycle speeds</title>',
  }));
  await page.goto('/intro-module-host');
  const report = await page.evaluate(async () => {
    const { sampleIntro } = await import('/src/intro.ts');
    // First, second, third, fourth and fifth cycle starts (seconds).
    return [0, 22, 66, 154, 330].map((start, cycle) => {
      const duration = [22, 44, 88, 176, 352][cycle];
      return { start: sampleIntro(start), beforeNext: sampleIntro(start+duration-1e-6),
        next: sampleIntro(start+duration), pairs: [0, 1, 2, 3].map(shot => {
          const point = shot*5.5+2;
          const original = sampleIntro(point), slowed = sampleIntro(start+point*duration/22);
          const later = sampleIntro(start+(point+.5)*duration/22);
          return { original, slowed, later, originalLater: sampleIntro(point+.5) };
        }) };
    });
  });
  for (const [cycle, result] of report.entries()) {
    expect(result.start.cycle).toBe(cycle);
    expect(result.start.rate).toBe(2**-cycle);
    expect(result.start.shot).toBe(0); expect(result.start.time).toBe(0);
    expect(result.beforeNext.shot).toBe(3); expect(result.beforeNext.time).toBe(.9999);
    expect(result.next.cycle).toBe(cycle+1); expect(result.next.shot).toBe(0);
    expect(result.next.rate).toBe(2**(-cycle-1));
    for (const { original, slowed, later, originalLater } of result.pairs) {
      expect(slowed.shot).toBe(original.shot);
      for (const property of ['phase', 'time', 'scale', 'fov', 'focus', 'exposure', 'opacity'] as const) {
        expect(slowed[property]).toBeCloseTo(original[property], 12);
      }
      expect(slowed.position).toEqual(original.position);
      expect(slowed.orientation).toEqual(original.orientation);
      expect(later.time-slowed.time).toBeCloseTo(originalLater.time-original.time, 12);
    }
  }
});

test('each cinematic view uses a linear clock in an honest, progressively later time window', async ({ page }) => {
  // A module-only host isolates the numerical choreography from rendering.
  await page.route('**/intro-module-host', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Intro choreography</title>',
  }));
  await page.goto('/intro-module-host');
  const report = await page.evaluate(async () => {
    const { sampleIntro } = await import('/src/intro.ts');
    return {
      shots: [0, 1, 2, 3].map(shot => ({
        start: sampleIntro(shot * 5.5, 0, .9999),
        first: sampleIntro(shot * 5.5 + 1.1, 0, .9999),
        middle: sampleIntro(shot * 5.5 + 2.2, 0, .9999),
        last: sampleIntro(shot * 5.5 + 3.3, 0, .9999),
        endpoint: sampleIntro(shot * 5.5 + 5, 0, .9999),
        fade: sampleIntro((shot + 1) * 5.5 - 1e-6, 0, .9999),
      })),
      loop: sampleIntro(22, 0, .9999),
    };
  });
  for (let shot = 0; shot < 4; shot++) {
    const s = report.shots[shot];
    expect(s.first.shot).toBe(shot);
    expect(s.start.startTime).toBeCloseTo(1 - 10 ** -shot, 12);
    expect(s.start.time).toBeCloseTo(s.start.startTime, 12);
    expect(s.first.time).toBeGreaterThan(s.start.startTime);
    expect(s.last.time - s.middle.time).toBeCloseTo(s.middle.time - s.first.time, 12);
    expect(s.endpoint.time).toBe(.9999);
    expect(s.start.opacity).toBeCloseTo(0, 5);
    expect(s.fade.opacity).toBeLessThan(.0001);
    expect(s.middle.opacity).toBe(1);
    expect(s.last.scale).toBeLessThan(s.first.scale);
    expect(s.last.scale/s.first.scale).toBeGreaterThan(.5);
    expect(s.last.exposure).toBeGreaterThan(s.first.exposure);
    expect(s.last.fov).toBeLessThan(s.first.fov);
    expect(s.middle.fov).toBeGreaterThan(10);
    expect(s.middle.fov).toBeLessThan(120);
    expect(Math.hypot(...s.middle.orientation)).toBeCloseTo(1, 8);
  }
  expect(report.loop.shot).toBe(0);
  expect(report.loop.time).toBeCloseTo(0, 12);
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
