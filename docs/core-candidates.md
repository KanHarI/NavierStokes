# Core feasibility after imposing the continuation conditions

The current visual field cannot be made source-compatible merely by reducing
its broad `sigma` parameter. The radial series must converge, its normalized
swirl must stay positive, and the continuation source and endpoint inequalities
must also hold. We now test those conditions separately before considering a
replacement dataset.

This investigation follows Appendix B.1–B.4 of the
[source paper](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf).
It is numerical screening of the local leading profile. It does not establish
the full construction or certify any parameter choice by interval arithmetic.

## Reproduce the comparison

From the repository root, using only Python's standard library:

```sh
python3 science/check_core_candidates.py --include-default --outer-schedule --lambdas 16 1000 1000000 10000000 --amplitude .001 --output docs/validation/core-candidates.json
```

The command writes a small report and does not modify browser datasets. The
[recorded results](validation/core-candidates.json) include parameters, runtime,
sampling locations, equation residuals, and distinct acceptance flags. For a
short individual comparison, omit `--include-default` and supply one Lambda.
`--h`, `--sigma`, `--outer-lambda`, and `--outer-p-star` permit other finite
choices without editing the source.

The baseline is the displayed diagnostic core: `sigma=.5`, `Lambda=16`,
`max(g)=.25`, and the rational pressure `Pi0=-4/(1+eta²)²`. Other rows use
`sigma=.0005`, `max(g)=.001`, and the complete pressure integral of the finite
unedited azimuthal schedule in `outer_schedule.py`. Choosing
`P_*=1.0985325849843381` normalizes that integral to `Pi0(0)=-4`, so the
comparison isolates compatibility and resolution changes from a pressure
amplitude change. This finite schedule is not the paper's nested large/small
parameter schedule, and its axial moment corrections remain separate work.

## What the checks mean

The sampler includes uniform points in `[-1,1]`, refined zeros of `Z_*`, the
unique zero `eta_H` of `H_*`, and points on both sides of that zero at two
different widths:

```text
chi transition width ≈ sigma / abs(H_*'(eta_H))
g peak standard deviation ≈ sigma / sqrt(Lambda L(eta_H) abs(H_*'(eta_H)))
```

The second expression is a local quadratic estimate of `log(g)`, not a claim
that the full axis amplitude is Gaussian. A uniform grid alone misses it.
The current comparison uses 57 axial points, seven radii through `Y=4.1`, and
Taylor orders 18, 24, and 32. Baseline axial locations differ because its
widths are broader.

For every sampled point we compare `Phi`, `U`, `Pi`, and their first radial
derivatives under order refinement, with error `abs(fine-coarse)/(1+abs(fine))`.
The equation check evaluates all three coupled B.15 balances. Its angular
equation is multiplied by `Phi` so it does not divide by an underflowed `g`;
the residual norm is `abs(lhs-rhs)/(1+abs(rhs))`. Acceptance requires positive
`Phi` and both last refinement and equation errors below `1e-7`.

Separate continuation checks require:

- The sampled/refined B.2 gate `chi>.99` on `abs(Z_*)<=delta_*`.
- Nonnegative sampled margin in B.17: `Sq - (2.5+.95 Lambda L chi)`.
- The B.19 endpoint alternative at `Y=4`, with margin above `2` greater than
  `.2`. Where `chi>.99`, we use the sufficient angular bound `p1>2.2`.
  Elsewhere we evaluate `p1+p2²/p1` using logarithmic amplitudes. This avoids
  reporting an exaggerated gap from dividing a tiny axial source by an even
  tinier swirl amplitude near unresolved axial-source zeros.

All minima are sampled, not certified bounds over the full rectangle. A zero
refinement change means the selected orders agree in floating-point arithmetic;
it does not mean zero error.

## What changed in the numerical picture

The broad displayed core has an accurate local solve but fails B.2. Sharpening
`sigma` while retaining `Lambda=16` can produce a divergent radial series and
negative `Phi`. Raising Lambda to `1000` resolves the local equations, yet the
sampled B.17 source bound still fails. At `Lambda=1,000,000` the source margin
is still negative near the narrow axis peak.

The normalized-pressure candidate with `Lambda=10,000,000`, `sigma=.0005`, and
`max(g)=.001` passes the sampled local tests: minimum `Phi` is approximately
`.271114`, maximum normalized equation residual is about `8e-13`, the B.17
margin is about `.355`, and the sufficient B.19 margin is about `1.36`.
Its B.2 minimum is approximately `.997573`. These checks provide a concrete
local candidate for further matching work, not a globally admissible field.

This candidate has an estimated axis-amplitude width of only `7.46e-8` in eta.
Eight samples per standard deviation on a uniform grid over `[-1,1]` would
require about **215 million axial intervals**. The existing 257-row lookup
cannot represent it. At many other axial samples the positive mathematical
amplitude underflows even float64. Storing zeros there and declaring a new
accurate field would be misleading.

An adaptive representation must retain `log(g)` or `log(F)`, resolve the narrow
peak separately from the wider `chi` transition, and validate off-grid field
values and derivatives. The normalized `Phi` radial series already converges
on the required patch for the tested finite candidate; the immediate storage
problem is the axial coordinate and amplitude range. No increase to the
existing uniform grid within the 100 MB budget resolves that problem.

## Limits that still prevent promotion to the public field

### Adaptive local artifact

`python3 science/generate_candidate.py` generates
`science/candidates/local-core/manifest.json` and `local-core.bin` without
changing the public datasets. The table contains 65 radial samples and 513
nonuniform eta samples, using a sinh map centered on the narrow amplitude
peak. It stores the streamfunction primitive and its Hermite derivatives,
plus `log(F)`, as little-endian float64. Thus underflowed swirl is not
mistaken for identically stationary fluid.

The recorded run took **56.1 seconds** and produced about **1.35 MB** including
metadata. At 148 off-grid queries, generation order 24 versus reference order
32 gave maximum swirl error divided by peak axis amplitude **0.0006662**
(0.06662%), and maximum normalized meridional error **5.34e-11**. These are
sampled errors, not uniform guarantees. The manifest includes the exact grid,
parameters, checksum, normalization, and scope. The existing public texture
sampler cannot load this format.

The peak-normalized swirl metric does not establish relative accuracy where
the velocity is almost zero. A separate check over all axial cell midpoints
records a maximum `log(F)` interpolation error of approximately **71,444**, in
a tail where `log(F)` is about **-22 million**. Those amplitudes make no
representable contribution to the velocity metric, but their ratios and
derivatives must not be treated as accurate. Log storage preserves finite
nodal values; it does not by itself validate interpolation of the full tail.

### Remaining mathematical conditions

The source chooses the outer parameters first, then `sigma` and Lambda, and
only then the complex-neighborhood amplitude bound `C`. A small real-axis
`max(g)` is not proof of that complex bound. The normalized finite outer
schedule above also fails the source's nested outer size requirements. Passing
the real-axis B.2/B.17/B.19 samples cannot repair either omission.

A limited additional probe of the literal necessary outer inequalities used
`T_d=exp(2)+10`, `h=exp(-T_d-1)`, `P_*=exp(T_d+1)`, and outer `lambda=.02`.
That produces pressure of order `-3e16`. Core trials with Lambda `1e18`, `1e20`,
and `1e40` overflowed the current double-precision Taylor jets at the axis
peak. At `1e40`, the estimated amplitude width is below `3e-24`, smaller than
the float64 spacing of eta near the peak. These limited failures do not prove
numerical reconstruction impossible; they show that the existing coordinate
and arithmetic representation cannot be used unchanged for those choices.

Before replacing the displayed field, the local candidate must be represented
and interpolated accurately, connected to its exterior with all required
moments and stress inequalities, and checked against the full parameter
requirements. The higher corrective construction and smooth forcing remain
separate unresolved work. The public dataset remains the explicitly labeled
finite approximation while those gates are open.
