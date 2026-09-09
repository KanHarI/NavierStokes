# Local axis parameters and the unmatched pressure boundary

The local solver uses the coupled equations (4.7), (4.13), and (B.15) from
[the source paper](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf).
It does **not** yet use the pressure obtained from the complete Appendix A
outer schedule. A successful local computation is not a globally matched
leading vortex or the full smooth-forcing construction.

## What the source prescribes

Lemma A.5 defines the pressure at the axis by

```text
Pi_0(eta) = -1/2 integral[-infinity,infinity] c(y)^2 f(eta)^(2 theta(y)) dy
f(eta) = 1/(1+eta^2),    y = log(X/X_R),    0 <= theta(y) <= 1.
```

The reference inner branch `E=P_* f exp(y/10)`, `y<=0`, contributes exactly
`-(5/2) P_*^2 f^2`. Other stages contribute additional negative terms.
The completed datum is even, analytic near `[-1,1]`, negative, and satisfies
`eta Pi_0'(eta)>0` away from zero. Its value is independent of `X_R`.
Pressure-preserving moment corrections do not change this datum.

The global outer schedule has strong nested size requirements, including
`T_d=exp(M_d)+10`, `P_*>exp(T_d)`, and `h<exp(-T_d)`. The finite diagnostic
parameters below have not been shown to satisfy that schedule. In particular,
choosing an analytic pressure with the right signs does not establish the
radial moment identities, cone inequalities, or exterior matching.

## Explicit diagnostic datum

`science/src/profile_parameters.py` provides

```text
Pi_0(eta) = -pressure_scale / (1+eta^2)^2
U_*(eta) = 4 eta + j0
H_* = D eta + (1-eta^2) U_*
W_* = 1 - 4(1-eta^2) - 2 D eta U_*
Z_* = -A(1-2 eta U_*)U_* - 4 H_*
      -(1-eta^2) Pi_0' + 4 A eta Pi_0
zeta_* = -L H_* / (H_*^2 + sigma^2)
chi = H_*^2 / (H_*^2 + sigma^2)
```

These are the B.1/B.3 definitions evaluated on a specified analytic pressure
family. `pressure_scale` is the whole coefficient, **not** the source's `P_*`.
The family has the exact shape of the reference inner pressure contribution,
but omits the rest of the outer-pressure integral. This is a boundary-data
choice for the source's local equations, not a replacement vortex formula.

The default finite parameters are `h=.005`, `j0=.025`, `pressure_scale=4`,
`sigma=.5`, `Lambda=16`. Set `g=phi_*/C` to have maximum `.25` at the unique
zero of `H_*`. Its logarithm is computed by adaptive quadrature:

```text
log g(eta) = log(.25) + Lambda integral[eta_H,eta] zeta_*(w) dw.
```

This preserves the exact B.3 logarithmic derivative, while avoiding large
unnecessary factors in `phi_*` and `C`. Since B.3 fixes `phi_*(0)=1`, the
normalization implies `log C=-log g(0)`.

## What the finite checks establish

The reproducible `parameter_diagnostics()` result for the defaults gives:

| Quantity | Numerical value |
| --- | ---: |
| Zero of `H_*` | -0.005561716315493014 |
| `Z_*` at that zero | 0.1325219635184188 |
| Minimum sampled `-W_*` | 2.93525 |
| `log C` | 1.3907381661379357 |
| Chosen `delta_* = abs(Z_*(eta_H))/4` | 0.0331304908796047 |
| Minimum sampled/refined `chi` where `abs(Z_*)<=delta_*` | 0.0004108140658893728 |

Thus the broad default axis data **fail the B.2 gate `chi>.99`**. They are
used only for a numerically validated local solve, without claiming the
Appendix B continuation theorem applies to these particular finite choices.

For comparison, changing only `sigma` to `.0005` produces a minimum sampled/
refined `chi` of approximately `.9975727` and `log C=15.3119693`. This is a
concrete parameter choice meeting that numerical gate; it creates much
narrower axial features. It does not certify that `Lambda` or `C` exceed the
existence theorem's thresholds, nor that outer matching is possible with the
selected diagnostic pressure. It is not the default displayed dataset.

The diagnostic routine samples `[-1,1]`, refines every bracketed `Z_*=0`
root, and refines the boundaries `Z_*=+/-delta_*`. Root refinement matters:
a coarse sample can miss the narrow region around `H_*=0`. These are numerical
checks, not interval-arithmetic proofs. Tests independently check the inner
pressure integral, its rational Taylor coefficients, the amplitude's
logarithmic derivative, and a root witnessing the default B.2 failure.

## What is still required for a matched construction

1. Instantiate the actual outer amplitude schedules in log coordinates.
2. Compute their entire pressure datum and the five cumulative radial moments.
3. Re-solve the axis equations with that datum and sufficiently resolved data.
4. Construct the connecting annulus with moment preservation and stress gaps.
5. Treat the higher corrections separately before making any smooth-forcing
   or complete-solution claim.
