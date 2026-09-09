# Local-core browser validation

Validated on September 9, 2026 using Chromium and Playwright's SwiftShader
WebGL 2 backend. Software-renderer frame rates are not hardware performance benchmarks.

All four local-core browser tests pass:

- The default dataset renders finite particles and nonzero light with white color.
- CPU and actual GPU samplers agree with independent offline physical references,
  remain regular on the axis, and reject queries outside the supported patch/time.
- Playback, time scrubbing to `t=0.9999`, and reframing leave fresh,
  visible dust in the contracted patch. Independent dust transport stays finite.
- An invalid core checksum prevents playback and displays a clear error.

The existing 13 browser checks also pass: navigation, exterior sampling,
play/pause, independent dust, controls, data integrity, unsupported WebGL,
Gaussian integrated light, overflow redistribution, and the projection-brightness
regression. The numerical suite contains 30 passing tests; the production build
passes TypeScript and Vite compilation.

A separate production smoke check served `dist/` under `/NavierStokes/`,
loaded the core and switched to the exterior using the field selector.
All asset/data requests stayed under that prefix, with no browser or HTTP errors.
The check captured [the current core preview](../core-preview.png).

The page uses manual reframing: scrubbing time does not move the ship.
**Reset view** frames the core at the selected time. The shader receives
CPU-computed remaining time directly, avoiding float32 cancellation in `1-t`.
Core transport substeps shrink with remaining time. Linear playback keeps its
selected wall-clock rate; logarithmic playback advances at a constant rate in
`-log10(1-t)`. Geometric substeps preserve the full requested physical interval.
If the interval exceeds the bounded particle budget, dust is reseeded at the
new field time. Only frozen-field independent dust may have its own speed capped.

Scientific limitations and interpolation divergence are documented in
[the numerical report](science-core.md) and [lookup audit](core-lookup.md).
These checks validate the implemented local model, not global matching or
the full corrected blowup construction. No hosted deployment was performed.

## Time progression and speed controls

Linear time is the default. The Time & transport panel offers linear or
logarithmic progression and an independent speed slider from 0.001 to 10
(linear simulation units/second, or logarithmic decades/second).

Regression tests exercise the actual animation loop with deterministic timestamps:
equal wall-clock intervals advance equal physical time in linear mode, including
near the endpoint and on frames longer than 50 ms. Changing speed changes that
rate; changing mode preserves the current time. Playback clamps at the finite
dataset endpoint and pauses. Additional transport tests check that geometric
substeps sum to the entire requested interval, overload triggers reseeding, and
frozen dust retains its separate bounded work budget.

On an independently solvable incompressible contracting strain, geometric RK2
errors at 43, 85, and 169 substeps are respectively `4.30e-7`, `1.11e-7`, and
`2.80e-8`, consistent with second-order convergence. The shader's loop bound is
a runtime uniform, bounded by 256 in the CPU planner, avoiding a large statically
unrolled shader on software renderers.
