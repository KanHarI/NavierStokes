# Scientific checkpoint: the heat exterior

The first implemented dataset reconstructs the **exact heat-exterior family in Appendix A.6**, on a bounded diagnostic annulus. It does **not** reconstruct the contracting core or the full corrected solution. Its parameters are independent diagnostic choices; they have not been matched to the global profile construction. The browser must identify it as **“Heat exterior · core not reconstructed.”**

This is a useful first numerical and browser integration checkpoint because it supplies a nontrivial, time-dependent, source-derived velocity with an independently verifiable equation. Its dust circulates. It has no radial inflow or axial outflow and does not demonstrate concentration or finite-energy blowup. Increasing browser resolution does not change those limitations.

## Source record

- [Source announcement](https://openai.com/index/navier-stokes-solution/).
- [Finite Time Blowup for Navier–Stokes, OpenAI](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf), retrieved September 9, 2026.
- Downloaded PDF SHA-256: `0e779481c4da40bd28d1e642e1d8ca57447d129610df28dfa5a11e9af8ae228f`.
- Implemented equations: (A.32)–(A.37). Additional isolated helper checks: (3.2)/(4.1) and (B.11).
- The Lean formalization has not been consulted or run. No upstream implementation code or paper artwork is included.

## Implemented velocity

Use nondimensional viscosity one, cylindrical radius `r = sqrt(x²+y²)`, axis `z`, and `tau = 1-t`. Define

```text
h = 0.005             diagnostic choice, not an assembled-proof parameter certificate
A = 1/2+h
cInfinity = 1         diagnostic amplitude normalization
Z = 4*tau/r²
H(Z) = integral_0^infinity exp(-v)*v^h*(1+Z*v)^(-h) dv / Gamma(1+h)
K(r,t) = cInfinity*(r²/2)^(-A)*H(Z)
u = (-K*y/r, K*x/r, 0)
```

Here `K` is azimuthal **linear velocity**, not angular velocity. The angular rate is `K/r`. The axis is excluded: this exterior expression cannot be extended there as the smooth core.

The shipped domain is `0.5 <= r <= 8`, `-8 <= z <= 8`, `0 <= t <= 0.99`. This is a chosen diagnostic crop of the exact family, not a computed location of the paper's core/exterior interface. Sampling outside this domain is invalid. The `t=1` reference determines the formula's clock; this cropped exterior remains finite as that time is approached at every allowed radius. The dataset starts with nonzero velocity and does not implement startup from rest.

## Pressure, viscosity, and forcing

The reference code computes pressure per unit density with its constant fixed at radial infinity:

```text
p(r,t) = -integral_r^infinity K(a,t)²/a da
```

The pressure gradient is radial, `grad(p)=K²/r * e_r`. Advection is `-K²/r * e_r`, so these cancel. Incompressibility is exact: the field is pure axisymmetric swirl and independent of height. Its remaining equation is

```text
partial_t K = K_rr + K_r/r - K/r²
```

The `-K/r²` vector-Laplacian term is essential. It follows independently from the scalar factor's equation

```text
Z² H'' + [1+2(1+h)Z] H' + h(1+h)H = 0.
```

Thus the external acceleration of this isolated family is exactly zero on `r>0,t<1`; the code does not define an arbitrary residual and then use that identity as its validation. Tests compare derivatives of velocity in physical coordinates against the heat operator, and separately differentiate an integrated pressure against centripetal acceleration. The pressure is currently available in the offline reference only. No claim is made about a localized global solution, finite total energy, or a smooth continuation through the axis.

All displayed future forces must distinguish acceleration from newtons. A voxel force would require supplied density, physical length/time units, and voxel volume. The present model uses nondimensional velocity and pressure per unit density.

## Numerical representation

The substitution `v=exp(w)` turns the gamma-weighted integral into a smooth integrand on `w`. Composite Simpson integration uses 512 intervals over `[-36,log(80)]`; 1024 intervals provide a refinement comparison. Low-end omitted mass is bounded by `exp(-36*(1+h))/((1+h)*Gamma(1+h))`; the high-end tail starts at `v=80`. Positivity bounds also bound these discarded tails for `H`. This is a double-precision numerical reference, not interval arithmetic or a proof of roundoff bounds.

The browser fetches 2,049 samples of `H` on `[0,16]`. All time dependence and amplitude scaling are reconstructed from the formula. No redundant time slices, Cartesian voxels, or dust trajectories are downloaded. Pressure is not required for tracer integration. JSON preserves the reference values; tests assess conversion to a float32 GPU table followed by linear interpolation separately.

The grid spacing in `Z` is a lookup resolution, not a core spatial resolution. The exact family has no unresolved random detail to reveal by shrinking. The declared sample domain still bounds navigation's scientific interpretation.

Reproduce the dataset and diagnostics from repository root:

```sh
python3 science/generate_preview.py
python3 -m unittest discover -s science/tests -v
```

Only the Python standard library is needed. The generator rejects failed numerical thresholds, missing lookup coverage, and preview size above 5 MB. The full intended dataset remains subject to the 100 MB cap; this checkpoint is approximately 54 KB, including the optional reference fixture, and runs in substantially less than one second in the initial measurement. It is not a high-resolution core generation run.

`velocity-reference.json` contains six Cartesian query points evaluated from the original double-precision integral. This optional, checksummed fixture lets browser tests compare sampled vectors against an independent numerical reference; it is not needed during playback. The browser validates model parameters, lookup coverage, byte sizes, and checksums before enabling transport.

## What remains before a leading-flow dataset

The source's leading flow is specified through coupled profile construction, rather than a ready numerical parameter set. A faithful implementation still requires the following connected work:

1. Instantiate the outer schedules and their pressure datum, preserving the required radial moments (Appendix A).
2. Select and numerically verify compatible parameters, including the amplitude and radial scales. Merely choosing `0<h<0.01` does not establish all later inequalities.
3. Construct the regular axis profiles, including the small asymmetric axial bias and the nonlinear radial/axial equations (Appendix B, equation 4.13).
4. Continue and join the profiles while preserving moments and stress inequalities; identify the actual valid core and exterior boundaries.
5. Evaluate derivatives, pressure, velocity, and the **approximation's** external residual accurately. The higher corrections needed for the theorem's smooth forcing remain a separate stage.

An isolated implementation of the similarity coordinate transform and Appendix B's scalar comparison series is included for later work. Neither produces a substitute core velocity. In particular, the scalar comparison alone does not satisfy the coupled field construction.

This checkpoint demonstrates that a genuine source component can be represented compactly and checked numerically. It leaves **the computational feasibility and accuracy of the complete leading flow unresolved**. It does not establish that the one-hour budget suffices for that construction.
