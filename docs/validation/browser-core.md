# Local-core browser validation

Validated on September 9, 2026 using Chromium and Playwright's SwiftShader
WebGL 2 backend. Software-renderer frame rates are not hardware performance benchmarks.

All four local-core browser tests pass:

- The default dataset renders finite particles and nonzero light with white color.
- CPU and actual GPU samplers agree with independent offline physical references,
  remain regular on the axis, and reject queries outside the supported patch/time.
- Playback, logarithmic scrubbing to `t=0.9999`, and reframing leave fresh,
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
Core transport substeps shrink with remaining time; both clocks are limited
together when synchronized transport would exceed the integration budget.

Scientific limitations and interpolation divergence are documented in
[the numerical report](science-core.md) and [lookup audit](core-lookup.md).
These checks validate the implemented local model, not global matching or
the full corrected blowup construction. No hosted deployment was performed.
