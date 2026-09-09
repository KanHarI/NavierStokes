# Incompressibility of the exported core lookup

The analytic local profile obeys the divergence constraint. The browser interpolates **F, U, and v0 separately**, so its bilinear field is not exactly divergence-free. This report measures that introduced error, independently of the much smaller analytic-profile residuals.

Evaluated dataset: `core-profile.bin`, SHA-256 `8296341badce5d5c9875ec3624b288bea9c590e4a9989505cb0b7ad320ff771e`. Parameters and scope are in `core-manifest.json`: the **unmatched diagnostic local core**, not a globally completed flow.

## Measurement

The test reads the actual little-endian float32 bytes and constructs the same bilinear interpolation as the browser. It differentiates that piecewise bilinear interpolant analytically within each grid cell, then applies the exact physical coordinate map and its derivatives. A separate Cartesian finite-difference check verifies this interpolated-field Jacobian.

For `X=Y/Lambda`, the divergence of the represented field is

```text
div(u) = q^(-1) * [v0 + X*v0_X
                  +(-2*A*eta*U + (1-eta²)*U_eta -2*eta*X*U_X)/(1-2*h*eta²)].
```

The derivatives in this expression belong to the interpolated table, not the analytic source profiles. Axisymmetric swirl cancels from the divergence, although it contributes to the full velocity gradient.

We test 1,024 deterministic off-grid profile-coordinate queries distributed over `0<Y<4.1` and `-0.9<eta<0.9`, shared across all three resolutions. Simulation times cycle through `0`, `0.9`, `0.99`, and `0.9999`. The two coarse grids are obtained by taking every fourth or second node of the final table; there is no extra profile solve or quantization change.

The principal dimensionless diagnostic is

```text
abs(div(u)) / ||S||_F,     S = [grad(u)+grad(u)^T]/2.
```

This compares artificial volumetric change with local deformation rate. Normalizing by the complete velocity-gradient Frobenius norm gives similar results. This is not a relative error against the true divergence: that denominator would be zero.

## Results

| Radial × axial entries | Median relative divergence | RMS | 95th percentile | Maximum |
| --- | --- | --- | --- | --- |
| 33 × 65 | 0.536% | 1.060% | 2.258% | 3.546% |
| 65 × 129 | 0.268% | 0.529% | 1.173% | 1.869% |
| **129 × 257** | **0.134%** | **0.266%** | **0.571%** | **0.907%** |

The RMS error halves with each doubling of resolution. This is consistent with **first-order derivative convergence of bilinear interpolation**, even though interpolated values converge faster. The maximum normalized by the full velocity-gradient norm is 0.905% on the final grid.

The final grid's largest sampled absolute divergence is approximately `750` in nondimensional inverse-time units, occurring near the final time where the physical gradient is also very large. Absolute incompressibility error therefore grows during concentration. The sub-one-percent sampled ratio should not be described as exact incompressibility or as a global bound. Small interpolation-induced compressibility can accumulate in long particle trajectories.

The initial regression gates are maximum relative divergence below 1.2%, RMS below 0.35%, and an RMS reduction by at least 30% at each refinement. They apply to this stated deterministic sample set. GPU arithmetic, coordinate approximation, and time integration errors are separate measurements. Derivatives are not defined classically on bilinear cell boundaries; queries here avoid those boundaries.

Reproduce the checks:

```sh
python3 -m unittest discover -s science/tests -p test_core_lookup.py -v
```

The measured error is acceptable for this initial visualization checkpoint with disclosure. A later derivative-sensitive or higher-accuracy release should investigate interpolating a divergence-preserving streamfunction or using a compatible higher-order representation; merely increasing tracer count does not reduce this field error.
