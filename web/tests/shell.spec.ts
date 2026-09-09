import { expect, test } from '@playwright/test';

// Exercise optics without creating the application or its particle population.
test.beforeEach(async ({ page }) => {
  await page.route('**/shell-test-host', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Shell optics test</title>',
  }));
  await page.goto('/shell-test-host');
});

test('visibility stays full inside the shell and fades continuously outside it', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { shellOptics, shellBounds, shellGaussianSigma } = await import('/src/shell.ts');
    const config = { near: 2, far: 4 };
    return {
      samples: [0, 1, 1.5, 2, 3, 4, 4.5, 5, 6].map(distance => ({ distance, ...shellOptics(distance, config) })),
      bounds: shellBounds(config),
      continuity: [1, 2, 4, 5].map(distance => ({
        left: shellOptics(distance - 1e-4, config),
        center: shellOptics(distance, config),
        right: shellOptics(distance + 1e-4, config),
      })),
      // Shell softening remains present with focus defocus turned off.
      outsideSigma: shellGaussianSigma(1.1, shellOptics(4.5, config).additionalSigma),
    };
  });
  expect(report.bounds).toEqual({ support: [1, 5], guard: [.75, 5.25] });
  expect(report.samples.map(sample => sample.visibility)).toEqual([0, 0, .5, 1, 1, 1, .5, 0, 0]);
  expect(report.samples.map(sample => sample.additionalSigma)).toEqual([24, 24, 12, 0, 0, 0, 12, 24, 24]);
  for (const { left, center, right } of report.continuity) {
    expect(Math.abs(left.visibility - center.visibility)).toBeLessThan(2e-10);
    expect(Math.abs(right.visibility - center.visibility)).toBeLessThan(2e-10);
    expect(Math.abs(left.additionalSigma - center.additionalSigma)).toBeLessThan(3e-9);
    expect(Math.abs(right.additionalSigma - center.additionalSigma)).toBeLessThan(3e-9);
  }
  expect(report.outsideSigma).toBeGreaterThan(12);
});

test('inner support clips at the origin and a zero near radius disables only the inner fade', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { shellOptics, shellBounds } = await import('/src/shell.ts');
    const clipped = { near: .2, far: 4, transitionWidth: 1 };
    const open = { near: 0, far: 4, transitionWidth: 1 };
    const invalid = [
      () => shellOptics(-1, clipped),
      () => shellOptics(NaN, clipped),
      () => shellOptics(1, { ...clipped, transitionWidth: 0 }),
      () => shellOptics(1, { near: 4, far: 2 }),
      () => shellBounds(clipped, 0),
    ].map(run => { try { run(); return false; } catch { return true; } });
    return { clippedBounds: shellBounds(clipped),
      clippedOpacity: [0, .1, .2, 3].map(distance => shellOptics(distance, clipped).visibility),
      openOpacity: [0, .1, 4, 4.5, 5].map(distance => shellOptics(distance, open).visibility), invalid };
  });
  expect(report.clippedBounds).toEqual({ support: [0, 5], guard: [0, 5.25] });
  expect(report.clippedOpacity).toEqual([0, .5, 1, 1]);
  expect(report.openOpacity).toEqual([1, 1, 1, .5, 0]);
  expect(report.invalid).toEqual([true, true, true, true, true]);
});

test('the shared GPU shell helper matches CPU visibility and Gaussian width', async ({ page }, testInfo) => {
  const report = await page.evaluate(async () => {
    const { SHELL_GLSL, shellOptics, shellGaussianSigma } = await import('/src/shell.ts');
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('WebGL 2 unavailable for optical helper validation.');
    const distances = new Float32Array([0, .75, 1, 1.125, 1.5, 1.875, 2, 3, 4, 4.125, 4.5, 4.875, 5, 5.25]);
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location=0) in float distance;
      out vec3 result;
      ${SHELL_GLSL}
      void main(){
        vec2 optics=shellOpticalWeights(distance,vec2(2.,4.),1.,24.);
        result=vec3(optics,shellGaussianSigma(1.1,optics.y,64.));
        gl_Position=vec4(0.,0.,0.,1.);
      }`);
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;out vec4 color;void main(){color=vec4(0.);}`);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment);
    gl.transformFeedbackVaryings(program, ['result'], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    const vao = gl.createVertexArray()!, input = gl.createBuffer()!, output = gl.createBuffer()!;
    const feedback = gl.createTransformFeedback()!;
    try {
      gl.useProgram(program); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferData(gl.ARRAY_BUFFER, distances, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 4, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, output); gl.bufferData(gl.ARRAY_BUFFER, distances.length * 12, gl.STREAM_READ);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
      gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, distances.length); gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      const values = new Float32Array(distances.length * 3);
      gl.bindBuffer(gl.COPY_READ_BUFFER, output); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, values);
      const errors = [...distances].map((distance, index) => {
        const optics = shellOptics(distance, { near: 2, far: 4 });
        const expected = [optics.visibility, optics.additionalSigma, shellGaussianSigma(1.1, optics.additionalSigma)];
        return Math.max(...expected.map((value, k) => Math.abs(value - values[index * 3 + k]) / (1 + Math.abs(value))));
      });
      return { maximumError: Math.max(...errors), samples: distances.length, glError: gl.getError() };
    } finally {
      gl.deleteTransformFeedback(feedback); gl.deleteBuffer(input); gl.deleteBuffer(output); gl.deleteVertexArray(vao);
      gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    }
  });
  expect(report.samples).toBeGreaterThan(10);
  expect(report.glError).toBe(0);
  expect(report.maximumError).toBeLessThan(2e-6);
  await testInfo.attach('shell-gpu-helper-audit', { body: JSON.stringify(report), contentType: 'application/json' });
});

test('Gaussian broadening conserves particle light while shell opacity deliberately attenuates it', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { shellOptics, shellGaussianSigma } = await import('/src/shell.ts');
    const results = [];
    for (const distance of [1.1, 1.5, 2, 3, 4, 4.5, 4.9]) {
      const optics = shellOptics(distance, { near: 2, far: 4 });
      for (const baseSigma of [1.1, 6, 30]) {
        const sigma = shellGaussianSigma(baseSigma, optics.additionalSigma);
        // Independent radial quadrature of the normalized 3-sigma Gaussian,
        // using the same physical support convention as the particle renderer.
        const radius = 3 * sigma, intervals = 2048, step = radius / intervals;
        const radialLight = (r: number) => optics.visibility * Math.exp(-r * r / (2 * sigma * sigma))
          / (2 * Math.PI * sigma * sigma * (1 - Math.exp(-4.5))) * 2 * Math.PI * r;
        let total = radialLight(0) + radialLight(radius);
        for (let i = 1; i < intervals; i++) total += (i % 2 ? 4 : 2) * radialLight(i * step);
        const energy = total * step / 3;
        results.push({ distance, sigma, opacity: optics.visibility, energy });
      }
    }
    return results;
  });
  for (const sample of report) {
    expect(sample.energy / sample.opacity).toBeCloseTo(1, 10);
  }
  const midpoint = report.filter(sample => sample.distance === 4.5);
  expect(midpoint).toHaveLength(3);
  for (const sample of midpoint) expect(sample.energy).toBeCloseTo(.5, 10);
});
