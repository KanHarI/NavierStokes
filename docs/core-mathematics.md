# Local core profile: mathematical contract

This document specifies the physical interpretation of a numerical **local solution of the source's leading core equations**. It does not certify the paper's parameter inequalities or construct the complete matched leading flow. The local core and the heat-exterior checkpoint are separate models: they must not be joined visually as one continuous field until matching has been constructed and validated.

The source is [Finite Time Blowup for Navier–Stokes](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf), equations (3.2), (4.1)–(4.7), (4.9), (4.13), and Appendix B. The retrieved PDF hash is recorded in [mathematics.md](mathematics.md). All derivatives below are mathematical derivatives of the profiles before lookup interpolation or storage quantization.

## Coordinates and the finite patch

Set `A=1/2+h`, `D=1/2-h`, `tau=1-t`. For physical cylindrical coordinates `(r,z)` solve

```text
q - z²*q^(2h) = tau,       q > 0
eta = z/q^D
X = r²/(2q)
d = 1-eta²
L = 1-2h*eta²
```

Equivalently, `tau=q*(1-eta²)` and `z=q^D*eta`. For `tau>0`, the physical branch is unique, with `q>=max(tau,abs(z)^(1/D))`. A bracketed solve is robust at the axis and near the plane `z=0`; an unguarded iteration on the wrong branch is not sufficient. On `abs(eta)<1`, `L>=1-2h>0`.

For the selected finite patch `abs(eta)<=0.9`, a cheaper fixed-point method is also justified. First check `abs(z)<=0.9*[tau/(1-0.9²)]^D`. Starting from `q0=tau`, iterate `q_next=tau+z²*q^(2h)`. Iterates are positive, monotonically increasing, and bounded above by the desired root. On the iteration interval the derivative is at most `2h*0.9²/(1-0.9²)^(1-2h)`, approximately `0.042` for `h=0.005`. Six iterations put truncation below ordinary float32 precision; ten are ample for the CPU display sampler. The offline reference keeps a bracketed solve. This iteration count is specific to these declared parameters and domain, rather than a general solver guarantee.

On the GPU, pass `tau=1-t` computed on the CPU as its own uniform. Computing `1-float32(t)` near `t=0.9999` would lose significant relative precision in `tau`, even with an otherwise accurate coordinate solver. Independent midpoint time evolution needs the same care.

A local profile dataset declares `0<=X<=Xmax` and `etaMin<=eta<=etaMax`, with its eta bounds strictly inside `(-1,1)`, plus a finite time interval ending before one. Some solvers use `Y=Lambda*X`; the manifest must specify which radial coordinate its table stores.

At a fixed time, the valid patch has a curved physical boundary:

```text
q = tau/(1-eta²)
z = [tau/(1-eta²)]^D * eta
r_max(eta,t) = sqrt(2*Xmax*tau/(1-eta²))
```

It is not a fixed physical cylinder. The browser must transform each query and check the declared profile-coordinate domain. Outside the patch, velocity is **unavailable**, not zero. Scaling the ship does not create valid data outside that patch. No reflection in `eta` may be imposed: the small axial bias deliberately breaks it.

## Velocity and pressure

Let the regular profiles be `F=phi/C`, `U`, and `Pi`. The azimuthal profile is `E=sqrt(2X)*F`. Define the radial prefix average

```text
M(X,eta) = integral_0^1 U(s*X,eta) ds
v0(X,eta) = [2*eta*U - 2*D*eta*M - d*M_eta]/L
V0 = X*v0
```

Then `r*u_r=V0`, `u_theta=q^(-A)*E`, `u_z=q^(-A)*U`, and `p=q^(-2A)*Pi`, where pressure is divided by density. The radial formula follows by integrating the divergence equation with regular axis value `V0(0,eta)=0`.

Use the following Cartesian expression, which never divides by radius:

```text
radial_coefficient = v0/(2q)
rotation_coefficient = q^(-A-1/2)*F
u_x = radial_coefficient*x - rotation_coefficient*y
u_y = radial_coefficient*y + rotation_coefficient*x
u_z = q^(-A)*U
p   = q^(-2A)*Pi
```

This remains regular at `r=0`; there `u_x=u_y=0`. The field's axis is the physical `z` axis. The prefix average has the analytic axis value `M(0,eta)=U(0,eta)`, so its derivative is also taken analytically there.

The pressure equation is `Pi_X=F²`. Once the axis pressure `Pi0(eta)` is selected,

```text
Pi(X,eta) = Pi0(eta) + integral_0^X F(s,eta)² ds.
```

This enforces `partial_r p=u_theta²/r` for `r>0`, cancelling the centrifugal acceleration. The limit is regular at the axis. In a local diagnostic solve, the chosen `Pi0` is a boundary datum; it is not a proof that pressure is normalized at the infinity of a globally joined flow.

## Leading profile equations

The equations can be expressed in the axis-regular scalar `F`, so the amplitude normalization `C` cancels. Define

```text
W  = 1 - 2*D*eta*M - d*M_eta
Hc = D*eta + d*U
ell = 1 + X*F_X/F

Sq = -W*ell - h*(1-2*eta*U) - Hc*F_eta/F
Sn = -W*X*U_X - A*(1-2*eta*U)*U - Hc*U_eta
     -d*Pi_eta +4*A*eta*Pi +2*eta*X*Pi_X

-2*L*(X*F_XX + 2*F_X)/F = Sq
-2*L*(X*U_XX + U_X)     = Sn
Pi_X = F²
```

The numerical patch must keep `F>0` and resolve its axial variation; division by a poorly resolved tiny `F` is not numerically benign. A solver may instead normalize `F` by its axis datum. If it expands in `Y=Lambda*X`, remember `partial_X=Lambda*partial_Y` and `X*partial_XX=Lambda*Y*partial_YY` when measuring physical profile residuals.

These equations include radial viscosity. They do not include every term of the full physical Navier–Stokes residual. Calling their solution an unforced Navier–Stokes solution would be incorrect.

## Independent physical-operator check

Define operators, with `X,eta` as independent profile coordinates:

```text
T_b f = (-b*f + D*eta*f_eta + X*f_X)/L
Z_b f = (2*b*eta*f + d*f_eta - 2*eta*X*f_X)/L

partial_t(q^b*f) = q^(b-1)*T_b f
partial_z(q^b*f) = q^(b-D)*Z_b f
```

For reference, direct implicit differentiation gives `q_t=-1/L`, `q_z=2*eta*q^(1-D)/L`, `eta_t=D*eta/(q*L)`, `eta_z=d/(q^D*L)`, `X_t=X/(q*L)`, and `X_z=-2*eta*X/(q^D*L)`.

Let `G=v0/2` and `B=-A-1/2=-1-h`. Independent leading tangential residuals computed from the physical mapping are

```text
Btheta = T_B F + 2*G*(F+X*F_X) + U*Z_B F - 4*F_X - 2*X*F_XX
Bz = T_(-A) U + 2*X*G*U_X + U*Z_(-A) U
     + Z_(-2A) Pi - 2*U_X - 2*X*U_XX.
```

Both should converge to zero as the actual leading equations are resolved. This form cross-checks the coordinate transformation, pressure, and cylindrical viscosity terms rather than simply reprinting a solver's own recurrence residual.

## Full external acceleration of the local approximation

At viscosity one define `f=partial_t u+(u·grad)u-Delta u+grad p`. The true force of the local approximation is not generally zero. In particular,

```text
f_theta = r*q^(B-1)*Btheta
          -r*q^(B-2D)*Z_(B-D)(Z_B F)

f_z = q^(-A-1)*Bz
      -q^(-A-2D)*Z_(-A-D)(Z_(-A) U).
```

Even when the leading brackets vanish, the omitted axial-viscosity terms remain. For the radial component, after exact centrifugal/pressure cancellation,

```text
Br = T_(-1) G + G*(G+2*X*G_X) + U*Z_(-1) G
     -4*G_X -2*X*G_XX

f_r = r*q^(-2)*Br - r*q^(-1-2D)*Z_(-1-D)(Z_(-1) G).
```

The composed `Z` operators act on everything to their right, including the first operator's coefficients. At the axis the radial and azimuthal residual components vanish for a smooth profile, while the axial component may be nonzero. The spatially and temporally varying residual above is the force of this approximation, not the smooth force guaranteed only after the paper's complete correction construction.

For a finite numerical truncation, retain the additional radial term `r*q^(-2A-1)*(Pi_X-F²)` instead of imposing perfect centrifugal cancellation in the reference force. This term measures the actual truncated profiles and tends to zero with improved pressure balance.

These formulas are a reference contract. Force export should remain unavailable until its derivatives and cancellation are separately validated; subtracting compressed browser contributions is not a reliable way to recover it.

## Finite diagnostic parameters and what they do not establish

The initial local experiment uses the axis datum shape `U*=4*eta+j0`, negative analytic pressure `Pi0=-P/(1+eta²)²`, and an angular datum determined by the Appendix B exponential prescription. The numerical configuration records `h`, `j0`, `P`, `Lambda`, the regularizing parameter `sigma`, and angular amplitude.

These are finite diagnostic choices. In particular, a broad `sigma` need not satisfy Appendix B's requirement that its auxiliary angular factor be close to one near specified zeros, and `Pi0` has not been produced by the complete outer scheduling/moment problem. A converged local solution can therefore be scientifically useful without satisfying the source theorem's global parameter construction. Reports must state actual inequality results and failures instead of treating a chosen parameter as automatically admissible.

Acceptance for this checkpoint requires finite fields, positivity where needed, convergent leading-equation residuals, incompressibility checks, consistent pressure, and reference-versus-export errors on a declared local patch. It does not establish annular stress inequalities, global moment matching, startup from rest, compact support, bounded total energy, or the full corrected blowup solution.

## Independent physical validation

`science/tests/test_core_physics.py` checks analytic profile derivatives against direct differences, Cartesian incompressibility including the axis, pressure/centrifugal balance, the nonzero axial bias, and the full analytic external acceleration against independently differenced physical velocity and pressure. The latter differentiates Cartesian fields in space and time; it does not reuse the `T`/`Z` operators from the analytic force routine.

At the initial diagnostic parameters and radial order 22, the maximum component error in that independent full-force comparison decreases approximately fourfold whenever the physical difference step is halved:

| Position and time | Step 0.0004 | Step 0.0002 | Step 0.0001 |
| --- | --- | --- | --- |
| `(0.05,0.03,0.02), t=0.8` | 0.00369 | 0.000923 | 0.000231 |
| `(0.1,-0.04,-0.03), t=0.9` | 0.0228 | 0.00569 | 0.00142 |
| `(0,0,0.03), t=0.9` | 0.000667 | 0.000167 | 0.0000417 |

At the finest listed step, errors normalized by `1+max(abs(f))` are below `2e-5`. Incompressibility differences decrease at the same second-order rate, reaching below `1e-6` absolute at spatial step `0.000025` for these three points. These are finite diagnostic samples and convergence evidence; they are neither global error certificates nor claims of vanishing full forcing.
