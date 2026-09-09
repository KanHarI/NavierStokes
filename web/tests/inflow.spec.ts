import { expect, test } from '@playwright/test';
import { inwardFlux } from '../src/inflow-glsl';

const zero = [0, 0, 0] as const;

test('stationary fluid has no incoming flux unless its observation shell moves', () => {
  expect(inwardFlux([2, 0, 0], zero, zero, zero, 0, 1, false)).toBe(0);
  // A camera moving toward +x encounters resting fluid at its +x outer face.
  expect(inwardFlux([2, 0, 0], zero, zero, [3, 0, 0], 0, 0, false)).toBe(3);
  expect(inwardFlux([-2, 0, 0], zero, zero, [3, 0, 0], 0, 0, false)).toBe(0);
  // Dilation admits stationary fluid at the expanding outer surface only.
  expect(inwardFlux([2, 0, 0], zero, zero, zero, .5, 0, false)).toBe(1);
  expect(inwardFlux([2, 0, 0], zero, zero, zero, .5, 0, true)).toBe(0);
});

test('incompressible affine stretching feeds the outer equator and inner poles', () => {
  // u=(-x/2,-y/2,z): exact divergence is zero.
  expect(inwardFlux([2, 0, 0], [-1, 0, 0], zero, zero, 0, 1, false)).toBe(1);
  expect(inwardFlux([0, 0, 2], [0, 0, 2], zero, zero, 0, 1, false)).toBe(0);
  expect(inwardFlux([1, 0, 0], [-.5, 0, 0], zero, zero, 0, 1, true)).toBe(0);
  expect(inwardFlux([0, 0, 1], [0, 0, 1], zero, zero, 0, 1, true)).toBe(1);
});

test('constant flow admits the exact analytic incoming flux through a sphere', () => {
  // Uniform h=cos(theta) quadrature integrates the whole sphere. For u=(0,0,v),
  // incoming flux is pi*r^2*v and the flux-weighted entry height is -2r/3.
  const count = 10_000, radius = 3, speed = 2;
  let sum = 0, heightSum = 0;
  for (let i = 0; i < count; i++) {
    const h = -1 + 2 * (i + .5) / count;
    const point = [radius * Math.sqrt(1-h*h), 0, radius*h] as const;
    const flux = inwardFlux(point, [0, 0, speed], zero, zero, 0, 1, false);
    sum += flux; heightSum += flux * point[2];
  }
  expect(sum / count * 4 * Math.PI * radius ** 2).toBeCloseTo(Math.PI * radius ** 2 * speed, 8);
  expect(heightSum / sum).toBeCloseTo(-2*radius/3, 6);
});

test('relative boundary flux is invariant under a shared constant translation', () => {
  const original = inwardFlux([1, 2, 3], [-2, 1, -4], zero, [.5, -.1, 1], .02, 1, false);
  const translated = inwardFlux([8, -3, 14], [2, 4, -6], [7, -5, 11], [4.5, 2.9, -1], .02, 1, false);
  expect(translated).toBeCloseTo(original, 12);
});
