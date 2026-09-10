import { expect, test } from '@playwright/test';
import { limitTransportFraction, planTransport, type TransportRequest } from '../src/transport';

test('the mobile clock limiter preserves time ratios within the shader step budget', () => {
  for (const isCore of [true, false]) {
    for (const ratio of [1, 4, -2, .25]) {
      for (const budget of [7, 63, 127]) {
        const request: TransportRequest = { isCore, tauEnd: .0001,
          timeDelta: .9999, transportDelta: .9999*ratio };
        const fraction = limitTransportFraction(request, budget);
        expect(fraction).toBeGreaterThan(0);
        expect(fraction).toBeLessThan(1);
        const delta = fraction*request.timeDelta;
        const plan = planTransport({ ...request, tauEnd: 1-delta,
          timeDelta: delta, transportDelta: fraction*request.transportDelta,
          maxSteps: budget+1 });
        // The production limit reserves one extra shader iteration for rounding
        // when reconstructing tau from the advanced physical clock.
        expect(plan.steps).toBeLessThanOrEqual(budget+1);
        expect(plan.reseed).toBe(false);
        expect(plan.limited).toBe(false);
        expect(plan.actualDelta/plan.timeDelta).toBeCloseTo(ratio, 13);
        expect(plan.tauStart).toBeCloseTo(1, 14);
      }
    }
  }
});

test('limited intervals eventually cover the full blowup approach without dropping tracer time', () => {
  const target = .9999;
  for (const ratio of [1, 3, -1]) {
    let time = 0, tracerTime = 0, chunks = 0;
    while (time < target) {
      const remaining = target-time;
      const fraction = limitTransportFraction({ isCore: true, tauEnd: 1-target,
        timeDelta: remaining, transportDelta: remaining*ratio });
      const nextTime = fraction === 1 ? target : time+remaining*fraction;
      expect(nextTime).toBeGreaterThan(time);
      expect(nextTime).toBeLessThanOrEqual(target);
      const delta = nextTime-time;
      const plan = planTransport({ isCore: true, tauEnd: 1-nextTime,
        timeDelta: delta, transportDelta: delta*ratio, maxSteps: 128 });
      expect(plan.reseed).toBe(false);
      expect(plan.limited).toBe(false);
      expect(plan.steps).toBeLessThanOrEqual(128);
      expect(plan.actualDelta).toBe(delta*ratio);
      tracerTime += plan.actualDelta;
      time = nextTime;
      expect(++chunks).toBeLessThan(100);
    }
    expect(chunks).toBeGreaterThan(20);
    expect(time).toBe(target);
    expect(tracerTime).toBeCloseTo(target*ratio, 12);
  }
});

test('the clock limiter leaves safe, paused and frozen-field requests unchanged', () => {
  for (const request of [
    { isCore: true, tauEnd: .8, timeDelta: .001, transportDelta: .001 },
    { isCore: false, tauEnd: .8, timeDelta: .001, transportDelta: .001 },
    { isCore: true, tauEnd: .0001, timeDelta: .9999, transportDelta: 0 },
    { isCore: true, tauEnd: .0001, timeDelta: 0, transportDelta: .1 },
    { isCore: true, tauEnd: .0001, timeDelta: 0, transportDelta: 0 },
  ]) expect(limitTransportFraction(request)).toBe(1);
  expect(() => limitTransportFraction({ isCore: true, tauEnd: 0,
    timeDelta: 1, transportDelta: 1 })).toThrow('Invalid particle integration request');
});

test('adaptive substeps span the entire requested physical interval', async ({ page }) => {
  await page.goto('/?field=core&debug=1');
  const results = await page.evaluate(async () => {
    const { planTransport, transportSubstep } = await import('/src/transport.ts');
    return [
      { tauEnd: .18, timeDelta: .02, transportDelta: .02 },
      { tauEnd: .00018, timeDelta: .00002, transportDelta: .00004 },
      { tauEnd: .8, timeDelta: 1e-12, transportDelta: 1e-12 },
    ].map(request => {
      const plan = planTransport({ isCore: true, ...request });
      let fieldSum = 0, transportSum = 0, largestFraction = 0;
      for (let i = 0; i < plan.steps; i++) {
        const step = transportSubstep(plan, i);
        fieldSum += step.fieldDelta;
        transportSum += step.transportDelta;
        largestFraction = Math.max(largestFraction, Math.abs(step.transportDelta) / (step.tau - step.fieldDelta));
      }
      return { plan, fieldSum, transportSum, largestFraction };
    });
  });
  for (const { plan, fieldSum, transportSum, largestFraction } of results) {
    expect(plan.reseed).toBe(false);
    expect(plan.limited).toBe(false);
    expect(fieldSum / plan.timeDelta).toBeCloseTo(1, 12);
    expect(transportSum / plan.requestedDelta).toBeCloseTo(1, 12);
    expect(largestFraction).toBeLessThanOrEqual(.0025 + 1e-14);
    expect(plan.actualDelta).toBe(plan.requestedDelta);
  }
});

test('integration overload reseeds at requested field time and only frozen dust can be limited', async ({ page }) => {
  await page.goto('/?field=core&debug=1');
  const results = await page.evaluate(async () => {
    const { planTransport } = await import('/src/transport.ts');
    return {
      advancing: planTransport({ isCore: true, tauEnd: .0001, timeDelta: .5, transportDelta: .5 }),
      frozen: planTransport({ isCore: true, tauEnd: .0001, timeDelta: 0, transportDelta: .1 }),
      paused: planTransport({ isCore: true, tauEnd: .0001, timeDelta: 0, transportDelta: 0 }),
    };
  });
  expect(results.advancing.reseed).toBe(true);
  expect(results.advancing.reason).toBe('integration-budget');
  expect(results.advancing.timeDelta).toBe(.5);
  expect(results.advancing.tauEnd).toBe(.0001);
  expect(results.advancing.limited).toBe(false);
  expect(results.advancing.actualDelta).toBe(0);
  expect(results.advancing.steps).toBe(0);
  expect(results.frozen.reseed).toBe(false);
  expect(results.frozen.limited).toBe(true);
  expect(results.frozen.reason).toBe('frozen-dust-budget');
  expect(results.frozen.steps).toBe(12);
  expect(results.frozen.actualDelta).toBeCloseTo(.012 * .0001, 14);
  expect(results.frozen.timeDelta).toBe(0);
  expect(results.paused.steps).toBe(0);
  expect(results.paused.actualDelta).toBe(0);
});

test('geometric RK2 converges on an independently solvable contracting strain', async ({ page }, testInfo) => {
  await page.goto('/?field=core&debug=1');
  const results = await page.evaluate(async () => {
    const { planTransport, transportSubstep } = await import('/src/transport.ts');
    // Incompressible strain with the same 1/tau growth as the core:
    // u=(-2x,-2y,4z)/tau. Exact trajectory is p_i(t)=p_i(0)*(tau0/tau)^a_i.
    const initial = [.1, .05, .03], alpha = [-2, -2, 4];
    const exact = initial.map((value, k) => value * (.2 / .18) ** alpha[k]);
    return [.0025, .00125, .000625].map(fraction => {
      const plan = planTransport({ isCore: true, tauEnd: .18, timeDelta: .02,
        transportDelta: .02, coreStepFraction: fraction });
      let point = [...initial];
      for (let i = 0; i < plan.steps; i++) {
        const step = transportSubstep(plan, i);
        const midpoint = point.map((value, k) => value + .5 * step.transportDelta * alpha[k] * value / step.tau);
        point = point.map((value, k) => value + step.transportDelta * alpha[k] * midpoint[k] / step.midpointTau);
      }
      return { fraction, steps: plan.steps, reseed: plan.reseed,
        error: Math.max(...point.map((value, k) => Math.abs(value - exact[k]))) };
    });
  });
  for (const result of results) {
    expect(result.reseed).toBe(false);
    expect(result.steps).toBeLessThanOrEqual(256);
  }
  expect(results[0].error).toBeLessThan(2e-6);
  expect(results[1].error).toBeLessThan(results[0].error / 3.5);
  expect(results[2].error).toBeLessThan(results[1].error / 3.5);
  await testInfo.attach('geometric-rk2-convergence', {
    body: JSON.stringify(results, null, 2), contentType: 'application/json',
  });
});
