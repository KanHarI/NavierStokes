# Perspective and tracer brightness calibration

## Reported defect

The initial view became brighter at the screen center regardless of camera orientation. This was a renderer normalization error: the point coordinates used a conventional rectilinear projection, but each angular tracer contributed the same screen-integrated light without accounting for the projection's change of area measure.

There was also an ambiguous FOV convention. The old 65° control meant vertical FOV, which is approximately 97° horizontally on a 16:9 display. It now explicitly means **horizontal FOV**, initially 65°. Perspective remains rectilinear and aspect-correct; no image warp, screen-centered dust distribution, or camera-dependent reseeding is used to conceal the issue.

## Camera response

For a pinhole image plane at distance f, at angle theta from its forward axis:

```text
dOmega / dA = cos(theta)^3 / f^2
```

Uniform samples per solid angle therefore produce more samples per unit pixel area near the image center. Equal pixel-space flux per sample incorrectly carries that sampling density into the displayed brightness. The solid-angle/image-area conversion also appears in the [PBRT perspective-camera directional density](https://www.pbr-book.org/3ed-2018/Light_Transport_III_Bidirectional_Methods/The_Path-Space_Measurement_Equation), section 16.1.1.

For this observatory's uniform angular exposure convention, each tracer's image-area weight relative to the optical axis is:

```text
imageAreaWeight = 1 / cos(theta)^3
                = (distance / forwardDepth)^3
```

The renderer applies this measure conversion before Gaussian normalization, exposure, and excess-light redistribution. A blur width change at a fixed particle position still conserves that particle's represented light. It does not promise identical integrated pixel flux for the same particle at different off-axis angles: the projection conversion deliberately accounts for that difference.

Entirely offscreen and backward-facing Gaussian footprints are culled before calculating the gain. This keeps grazing directions from introducing arbitrarily large weights; the viewport plus each footprint's guard band bounds all contributing directions.

This is an ideal observational response, not a simulation of a particular photographic lens, aperture, sensor, or lens vignetting. The individual point density still follows perspective geometry. The corrected quantity is average image brightness for a uniform angular field. Actual spatial variation in the fluid, domain boundaries, and particle shot noise remain visible.

## Regression fixture

`renderer.auditProjection()` uses the actual particle draw shader to render 80,000 deterministic Fibonacci-sphere samples. The shell is entirely inside the valid field domain, centered at `[4,0,0]`, with scale 0.5 and radius two ship-scale units. Particle ages are fixed and there is no transport or reseeding. This isolates camera response from fluid structure.

The audit measures raw linear HDR light in seven equal-area image regions, before overflow processing and display clipping. It repeats at three camera orientations and two fields of view (65° and 100°). The regression requires the center-to-outer mean ratio to remain within 8% of unity and the maximum region mean to be less than 1.12 times the minimum. These tolerances include finite-sample variation and Gaussian rasterization; they are not a claim of exact pointwise uniformity.

The original implementation fails this test. With its old vertical-FOV convention, the center-to-outer ratio was approximately 1.422 at 65° and 2.591 at 100°, virtually unchanged by camera rotation. This confirms a camera-centered bias rather than a feature tied to the fluid.

After the normalization correction, with the explicit horizontal-FOV convention, the measured center-to-outer ratios are:

| Horizontal FOV | Forward | 90° yaw | Tilted |
| --- | --- | --- | --- |
| 65° | 1.000077 | 1.000136 | 1.000377 |
| 100° | 1.000508 | 1.000832 | 1.000733 |

The maximum-to-minimum regional ratio is at most 1.001403 across all six renders. Both the corrected narrow and wide views are uniform to well within the regression tolerances. The old and new numerical FOV settings represent different angular extents; these are separate failing and passing fixture measurements, not a same-angle before/after comparison. Gaussian and excess-light conservation regressions also pass after the change.

Run the regression with:

```sh
npm run test:browser -- web/tests/projection.spec.ts
```

The Gaussian and overflow-conservation tests remain separate: uniformity must not be obtained by hiding a loss or gain of light in those later passes.
