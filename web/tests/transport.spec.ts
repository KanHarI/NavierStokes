import { expect, test } from '@playwright/test';

test('adaptive substeps span the entire requested physical interval', async ({ page }) => {
  await page.goto('/?debug=1');
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
  await page.goto('/?debug=1');
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
  await page.goto('/?debug=1');
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
