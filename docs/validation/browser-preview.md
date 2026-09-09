# Browser prototype validation

This report covers the first heat-exterior viewer, not the unresolved core or full blowup construction. See [the scientific report](science-preview.md) for the offline reference calculations.

## Environment

- Node.js 24.13.0 and Python 3.14.5 on the development Mac.
- Playwright Chromium with SwiftShader enabled for repeatable headless WebGL checks.
- 1280 × 900 browser viewport for the main smoke test.
- Production output built with TypeScript checking and Vite.

Software-rendered test frame rates are not a hardware performance benchmark. Safari and native GPU performance are not yet validated. The rendered canvas can be adjusted independently using the resolution and density controls.

## Verified behavior

- Dataset and table load successfully with checksum validation; corrupted chunks produce a visible error and disable playback.
- A missing WebGL 2 context produces an actionable visible error.
- GPU particle samples are finite and render without browser console or WebGL errors.
- Exposure, density, and multiplicative scale are independent controls.
- Pausing freezes simulation time; independent dust transport continues changing particle positions while that clock remains frozen.
- The browser's CPU sampler agrees with independent integral reference samples, including radial-boundary points. Invalid-domain queries return no sample rather than stationary fluid.
- The actual GPU field shader agrees with all six integral reference samples at a tolerance of `1e-6 + 2e-6 * abs(reference)` per velocity component, including exact radial endpoints.
- Translation follows ship orientation and normalizes simultaneous input. Repeated local rotations preserve a unit quaternion.
- Editing interface fields does not trigger flight shortcuts; focus loss and pointer release clear held keys; disposing navigation removes its handlers.
- The actual GPU redistribution shaders conserve linear luminance within 1% on centered, edge, colored, and uniformly overloaded synthetic images.
- The actual Gaussian particle shader preserves integrated light within 1% for three distances at the tested minimum spot size. With a target of 12 light units, measured near/focus/far totals were 11.9127, 12.0693, and 11.9944. A 1.1-pixel minimum Gaussian width limits the pixel-sampling error observed with smaller points.
- Uniform full-screen overexposure retains an explicit residual. The test verifies that display capacity is not falsely reported as sufficient.
- A deterministic uniform shell remains approximately uniform in raw image brightness across camera rotations and fields of view. The [projection calibration](projection.md) documents the original bias, measure conversion, and actual GPU measurements.

The GPU tests measure represented light before display encoding. They do not claim exact subjective brightness conservation. Half-float framebuffer rounding, finite Gaussian footprints, and pixel sampling all need to be accounted for separately.

## Scope and remaining work

The renderer uses a finite multiscale redistribution pass budget. When it cannot spread all excess below display capacity, the remaining fraction is reported in the interface. The final display necessarily clips that unresolved portion; lowering ISO is the manual remedy. Future work can extend the spreading strategy without pretending the current residual is zero.

The local dust population uses a bounded reservoir with recycling and smooth reseeding transitions. It is a visualization sampling system, not a conserved material mass distribution. Precise density statistics near moving scientific-domain boundaries and extreme-scale navigation remain refinement work. Particle positions currently use GPU float32; a compensated coordinate representation for extreme zoom remains open.

The production bundle was served under `/NavierStokes/` and tested in Chromium. The page, JavaScript, CSS, manifest, and heat table all loaded under that prefix, particles rendered, and no request or WebGL errors occurred. No public website deployment, Safari certification, full-grid fluid simulation, or one-hour final dataset run has been performed.

Run the checks with:

```sh
npm run build
npm run test:science
npx playwright install chromium
npm run test:browser
```

The development build exposes `window.__observatory` for deterministic tests. A production build exposes the same diagnostics only with `?debug=1`. `renderer.audit()` reads a particle sample and light totals; `renderer.auditLight()` renders synthetic redistribution cases; `renderer.auditGaussian()` compares integrated light at three focus distances; `renderer.auditVelocity()` samples the transport shader's field directly for scientific-reference comparisons.
