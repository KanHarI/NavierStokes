# A defined fluid outside the local core

The finite-time diagnostic continuation in `science/src/extended_flow.py`
defines velocity at **every finite physical position** for `t<1`. It retains
the previously computed coupled core, joins its azimuthal motion to the
source's heat exterior, and smoothly localizes the resulting field in space.

This is a prescribed forced field. The surrounding fluid has not been evolved
by an independent Navier–Stokes solver. Its required external acceleration
is computed from the complete physical momentum residual. It is not the
paper's globally matched construction, and no smooth extension of that force
through `t=1` is claimed.

## Preserving the core and continuing its streamfunction

Use the existing source coordinates

```text
A=.5+h, D=.5-h, d=1-eta², L=1-2h eta², Lambda=16
tau=1-t, q=tau+z² q^(2h), eta=z/q^D, Y=Lambda*r²/(2q).
```

The reference code starts the fixed-point inversion at
`q0=max(tau,abs(z)^(1/D))`. Its contraction is at most `2h` on the interval
between that starting value and the solution, including positions beyond
the old `abs(eta)<=.9` crop. Ten iterations suffice for the tested finite
domain. Physical positions with `R>=8` return zero before this calculation.

Let `M(Y,eta)=integral[0,Y] U(s,eta) ds / Lambda` be the source core's radial
primitive. The implementation uses the **literal derivative prescription of
equation B.22**, with logarithmic coordinate `a=log(Y/4.1)` and finite
transition width `t1=.005`:

```text
b(Y)=1-sigma((log(Y/4.1)-t1)/t1)
partial_Y U_reference = b(Y) partial_Y U_core
partial_Y log F_reference = b(Y) partial_Y log F_core.
```

Here `sigma` is the source's specific A.5 step: its numerator is
`exp(-1/s²)` and its denominator is
`exp(-1/s²)+exp(-1/(1-s)²)` for `0<s<1`, extended by zero and one at the
respective ends. This step is infinitely differentiable and flat at its
endpoints. The reference equals the analytic core through
`Y_start=4.1 exp(.005)`, freezes its derivatives between `Y_start` and
`Y_end=4.1 exp(.01)`, and has constant `U_reference,F_reference` afterward.
It only accesses natural profiles through approximately `Y=4.142`, within
the numerically checked positive/converged interval through `Y=5`.

The numerical attachment radius is `4.1/Lambda`, preserving the complete
old core. This differs from the source's choice `4/Lambda`; the finite
parameters still carry no claim of satisfying the B.23 stress inequalities.

The actual continued primitive is computed by integration by parts:

```text
M_reference(Y) = M(Y_start)
  + [(Y-Y_start) U(Y_start)
     + integral[Y_start,Y] (Y-s) b(s) partial_s U_core(s) ds] / Lambda.
```

Its axial derivative is computed from the corresponding axial Taylor jets.
Above `Y_end`, the primitive grows linearly with slope
`U_reference(Y_end)/Lambda`. Scalar quadrature over the short collar and
cached endpoint data avoid numerically extrapolating the core series to
large radii.

For the subsequent diagnostic joins, retain the separate smooth step
`S(s)=exp(-1/s)/(exp(-1/s)+exp(-1/(1-s)))` inside `(0,1)`, extended flatly.
Set `w(Y)=1-S((Y-4.9)/(16-4.9))` and define

```text
J(Y,eta) = w(Y) M_reference(Y,eta)
J_Y = w_Y M_reference + w U_reference/Lambda
J_eta = w partial_eta M_reference
psi(r,z,t) = q^D J(Y,eta).
```

The physical meridional flow is the curl of its streamfunction:

```text
u_r = -psi_z/r
u_z = psi_r/r = q^(-A) Lambda J_Y
r u_r = [2 eta Y J_Y - 2 D eta J - d J_eta]/L.
```

Differentiating the **actual extended primitive**, including the reference
continuation and cutoff terms, is essential. Blending radial and axial velocity components
independently would generally violate incompressibility.

The reference continuation follows Appendix B.5 directly. Its subsequent
primitive taper follows the source's streamfunction/curl method in Section
10.1. The latter join remains a finite diagnostic choice, **not** the
certified B.26 stress construction or the full five-moment matching.

## Joining the azimuthal velocity to the heat exterior

Write `X=Y/Lambda`, and `F_core=E_core/sqrt(2X)` as in the existing dataset.
Use

```text
F_base = w F_reference(Y,eta) + (1-w) F_heat(Y,eta)
F_heat = c_infinity X^(-1-h) H(2d/X) / sqrt(2)
F_extended² = F_base² + pressure_deficit(eta) bump(Y)
u_theta = q^(-A) sqrt(2X) F_extended.
```

The heat branch is evaluated only where `Y>4.9`, so its singular formula
never reaches the axis. The finite diagnostic amplitude is `c_infinity=.02`.
It has not been obtained by the paper's global moment matching.

The additional nonnegative swirl-energy bump is supported in `6<Y<14`
and normalized to have `integral bump(Y) dX=1`. Its coefficient is

```text
pressure_deficit(eta) = -Pi_0(eta) - integral[0,infinity] F_base² dX.
```

The code checks that this coefficient is finite and nonnegative. This
corrects the **actual radial pressure moment**, rather than blending two
unrelated pressures: `Pi_X=F_extended²`, `Pi(infinity)=0`, and the existing
axis pressure is preserved. The bump leaves the old core and the final
heat exterior unchanged. In addition, `J(Y,eta)=0` beyond the join and
`U=Lambda*J_Y` enforce the source's zero total axial moment
`integral[0,infinity] U dX=0` exactly for this unlocalized profile.

Two of the five cumulative conditions in source equation (4.15) are
therefore enforced: the pressure increment `C_p` and the axial primitive
`M`. There is a notation difference here: the implementation's
streamfunction primitive `J` is the paper's `M`; the paper's separate
quantity `J=integral U H dX` has not been matched. With
`H=sqrt(2X) E`, the **three remaining integral conditions** concern that
`U H` moment, `S=integral(U²-E²/2) dX`, and the angular-momentum integral
relative to the prescribed exterior power. These conditions and the
annular stress cone remain uncertified. All these profile-moment
statements precede the physical localization below.

At `Y>=16`, the meridional streamfunction and its derivatives vanish, and
the unlocalized velocity is precisely the paper's isolated heat-exterior
family. This region is a valid fluid sample. It does not become an invalid
or empty rendering region when the core contracts.

## Physical localization and the regular axis

Define `C=1-S((R²-16)/48)`, where `R²=r²+z²`. Then `C=1` at `R<=4` and
`C=0` at `R>=8`. Localize the streamfunction before differentiating:

```text
psi_local = C psi
u_r_local = C u_r - C_z psi/r
u_z_local = C u_z + C_r psi/r
u_theta_local = C u_theta.
```

Consequently the localized flow remains divergence-free. In Cartesian
coordinates the code uses `u_r/r`, with the regular limiting quantities
`J/Y` and `J_eta/Y`, instead of dividing a zero streamfunction by a zero
radius. On the axis,

```text
psi/r² -> q^(-A) U_axis/2
u_r/r = C (u_r_base/r) - 2 z C_(R²) psi/r²
u_z = C u_z_base + 2 C_(R²) psi.
```

Thus particles beyond `R=8` occupy a mathematically defined stationary
fluid. They should remain visible and stationary, subject to the user's
optical shell. Rest is distinct from missing data.

## Pressure, full force, and validation

Before physical localization, the pressure is the normalized radial integral
of the matched swirl, then multiplied by `C`:

```text
Pi(X,eta) = -integral[X,infinity] F_extended(x,eta)² dx
p = C q^(-2A) Pi(X,eta).
```

This preserves the old pressure throughout the unchanged core, satisfies
the source's leading centrifugal pressure balance throughout the similarity
join, and gives the exact heat pressure beyond it. Multiplication by the
physical cutoff creates additional pressure-gradient terms; the full force
diagnostic includes those terms.

The offline `force` function evaluates

```text
f = partial_t u + (u dot grad)u - Laplacian(u) + grad(p)
```

using independent physical finite differences. Every cutoff and mapped
coordinate contribution is included because the differences are taken
through the full physical velocity and pressure evaluators. Reducing the
step checks convergence. This is a calculation of the force required by
the prescribed field, not an independent proof of that field's physical
accuracy. Separate tests check divergence, preservation of the old core,
regularity of the axis, continuity of the join, and reduction to the exact
heat exterior.

The force is nonzero in the transition and localization regions, and may
grow without a smooth limit as `t` approaches one. The source's smooth-force
result requires completion of the five-moment matching, stress cone conditions,
oscillatory/background corrections, and localization estimates; these have
not been established for this diagnostic continuation.

Independent checks in `science/tests/test_pressure_match.py` include the
actual added annular swirl: its integrated pressure moment is checked with
refined quadrature, its pressure derivative is checked against `F²`, and
the full acceleration within the bump is checked for finite values and
convergence under smaller physical difference steps. The manifest's short
force fixture alone does not cover every transition or certify its force
near the singular time.

The default browser uses a bicubic Hermite streamfunction and differentiates
that same interpolant for both meridional velocity components. Its curl
structure preserves incompressibility up to numerical evaluation error,
separately from interpolation error relative to the continuous reference.
The older [bilinear core audit](validation/core-lookup.md), including its
0.266% RMS divergence measurement, applies only to the optional isolated
core dataset; it does not describe this default Hermite continuation.
