# Contracting local-core numerical checkpoint

This checkpoint solves the paper's coupled local axis-profile equations
with an explicitly chosen analytic pressure datum. It is **not** joined to
the heat exterior, and is not the full corrected smooth-forcing construction.
See [the parameter limitations](../core-parameters.md) and the machine-readable
[validation report](science-core.json).

Reproduce it from the repository root:

```sh
python3 science/generate_core.py
npm run test:science
```

## Representation and measured accuracy

| Item | Result |
| --- | --- |
| Stored fields | `F`, `U`, `v0`, `Pi` in float32 |
| Profile coordinates | `0 <= Y=16X <= 4.1`, `abs(eta) <= .9` |
| Grid | 129 radial × 257 axial-profile samples |
| Numerical construction | Degree-22 radial Taylor expansion with axial Taylor jets |
| Independent truncation comparison | Degree 26 at 63 off-grid/boundary points |
| Largest sampled order-22/26 field difference | About `2.8e-17` |
| Largest sampled relative leading-equation residual | About `3.0e-13` |
| Smallest sampled normalized azimuthal profile `Phi` | About `.2141` |
| Largest sampled interpolation error normalized by channel maximum | About `.000626` (`.063%`) |
| Binary profile size | 530,448 bytes |
| Complete preview including manifest and references | 543,690 bytes (about 544 KB) |
| Generation elapsed time on the development Mac | 22.5 seconds |

The interpolation error is normalized by each channel's maximum absolute
value over the exported grid. It is **not** a uniform relative-error bound
near a field zero. The report separately includes each channel's absolute
error and measurements on coarser 33×65 and 65×129 grids.

Float64 reference velocities at 15 physical positions/times are evaluated
without interpolating the exported grid. They include the axis and times
approaching `t=.9999`. The CPU's ten-iteration and GPU's six-iteration similarity-coordinate
inversions is compared with known coordinates. Scientific tests check the
binary hashes and reconstruct velocities from float32 interpolation against
those independent reference values.

## Interpretation and limits

The local profiles are smooth through the axis at every represented `t<1`.
Their similarity transformation contracts spatial scales and increases
velocities as the reference time approaches. The dataset contains reusable
profiles rather than a stack of 3D voxel snapshots. Queries outside its
`Y,eta` rectangle are unsupported even when they fall inside the broad
Cartesian bounding box in the manifest.

The implemented pressure is per unit density. It satisfies the leading
centrifugal radial balance; it is not chosen by matching the complete outer
pressure schedule. The small leading-equation residual is a numerical
equation check, not a certificate that the full Navier–Stokes force vanishes
or is smooth at the singular time.

**External-force fields are not exported in this dataset.** Full momentum
residual diagnostics in the offline reference concern this local
approximation; the browser should not report them as the smooth forcing of
the complete construction. Annular matching, moment preservation,
localization, startup from rest, and the oscillatory/background corrections
remain outstanding.

The default finite parameter choice fails the source's B.2 continuation
gate. This fact is retained in the manifest, report, and parameter tests.
Numerical convergence of the local equations does not remove that limit.

Bilinear interpolation does not preserve exact incompressibility. The separate
[exported-field audit](core-lookup.md) measures RMS divergence of 0.266% of
local strain and a maximum of 0.907% on 1,024 queries.
