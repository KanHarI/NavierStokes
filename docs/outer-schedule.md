# Finite outer schedule and axis pressure

`science/src/outer_schedule.py` now evaluates the azimuthal reference schedule
in Appendix A.2 and its complete axis-pressure integral (A.21) from the
[source paper](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf).
The source was retrieved September 9, 2026; its checksum is recorded in
`mathematics.md`. This is a new offline mathematical component. It does not
replace the displayed dataset or complete the matched outer flow by itself.

## What is constructed

In global log radius `y=log(X/X_R)`, write

```text
E(y,eta) = c(y) f(eta)^theta(y),  f(eta)=1/(1+eta^2)
Pi0(eta) = -1/2 integral E(y,eta)^2 dy,  -infinity<y<infinity.
```

The implementation includes the reference inner branch
`E=P_* f exp(y/10)`, axial-reduction ramp and hold, intermediate power-law
ramp and hold, azimuthal profile during the axial pulse, interpolation from
`f` to `1/2`, angular-correction interval, exterior release and recovery,
terminal waiting interval, terminal transition, and infinite exterior power.
The slope prescription is `d log(E)/dy=l-1/2` and the transition function is
exactly the smooth step (A.5), not a polynomial replacement.

The waiting length is determined from (A.13): integrate
`Q'+(1+l)Q=-l-h` from the corrected initial value
`Q=(lambda-h)/(1-lambda)`, compute the terminal target `Qp`, and hold at
`l=-h` for `log(Q/Qp)/(1-h)`. The terminal factor is the source's
`f_o=1-c_o*h*[1-sigma((y-1)/2)]`.

The two angular bumps from (A.11) are omitted in this **pressure reference**.
This is permitted by Lemma A.5 because their total pressure increment is
zero. Their effect on the angular moment still determines the initial `Q`
used above. Omitting them does **not** mean the unedited E evaluator has the
correct angular moment. The axial pulse's U amplitudes are likewise not
constructed; they do not enter the pressure integral.

## Numerical representation

The pressure is stored as a positive weighted mixture

```text
-Pi0(eta) = sum weight_j * (1+eta^2)^(-power_j),  0<=power_j<=2.
```

Both infinite tails and constant-slope intervals are integrated analytically.
Finite smooth transitions use Simpson quadrature. The mixture gives analytic
eta derivatives and arbitrary-order Taylor coefficients using
`(1+eta^2)F'=-2p*eta*F` for `F=(1+eta^2)^(-p)`. The axis solver can use these
coefficients directly; it need not differentiate a lookup table.

Log radii and amplitudes avoid forming enormous physical radii. A reported
stage position is therefore `log(X/X_R)`, not a radius. Extremely small tail
weights may underflow in float64; they have no effect at the reported
pressure accuracy. This numerical representation is not interval arithmetic.

## Reproducible finite candidate

The default diagnostic schedule has `M_d=2`, `lambda=.08`, `h=.005`, `P_*=1`,
`T_f=30`, and `c_o=.005`. It gives:

| Quantity | Value |
| --- | ---: |
| `T_d=exp(M_d)+10` | 17.3890561 |
| Full `Pi0(0)` | -3.314622729224217 |
| Inner-branch contribution | -2.5 |
| Outer fraction of pressure magnitude | 24.5766% |
| 256-to-512 transition-quadrature difference at eta=0 | 4.12e-13 |
| Log radius where the infinite exterior power begins | 476.6563291 |

For comparison with the previous diagnostic pressure coefficient 4, take
`P_*=sqrt(4/3.314622729224217)=1.0985325849843381`. This is an explicit amplitude
normalization, not the source's prescribed large parameter. Most of the
pressure comes from stages with `theta=1`; after this normalization its
shape is indistinguishable from `-4/(1+eta^2)^2` at float64 precision for this
candidate. Thus deriving the full pressure does not by itself predict a
different-looking core. The narrow compatible angular parameters and radial
matching remain the more significant potential visual changes.

## What is not certified

The source requires the nested choices (A.6): sufficiently large `M_d`,
`T_d=exp(M_d)+10`, `P_*>exp(T_d)`, sufficiently small lambda, and still smaller
`h << min(lambda,exp(-T_d))`. The finite candidate fails even the explicit
`log(P_*)>T_d` and `log(h)<-T_d` tests. Neither the unspecified smallness
thresholds nor stress cones have been verified. A successful B.2 axis gate
with this pressure cannot remove those global limitations.

The two explicit inequalities can be satisfied in finite arithmetic: retain
`M_d=2`, take `lambda=.02`, `P_*=exp(T_d+1)=96887018.4082`, and
`h=exp(-T_d-1)=1.03213001745e-8`. The evaluator then gives
`Pi0(0)=-3.11146762529e16` and exterior log radius `1155.52105`. This is a
useful necessary-condition check, not a theorem-compatible parameter
certificate: the unspecified sufficiently-large/sufficiently-small bounds
remain unchecked. Normalizing that pressure back to magnitude 4 would again
violate the prescribed P_* inequality; it cannot be presented as satisfying
both requirements simultaneously.

The five matching functions in (4.15) are

```text
M  = integral U dX
I  = integral sqrt(2X) E dX
J  = integral U sqrt(2X) E dX
S  = integral (U^2-E^2/2) dX
Cp = integral E^2/(2X) dX.
```

They must match as functions of eta at a joining radius where the profiles
also rejoin, with the same axis pressure. Lemma 4.4 then restores the outer
pressure, radial velocity, and integrated stresses; eta derivatives matter
for those stresses. Matching only pressure and radial velocity is
insufficient. Appendix A.3 closes M/J with two axial bumps, S with an axial
pulse amplitude, and I/Cp with two azimuthal bumps. Those nonlinear closures,
the core-to-reference five-moment correction, the heat replacement, and
higher corrective disturbances remain separate work.

Validation is in `science/tests/test_outer_schedule.py`: independent direct
log-radius pressure integration, analytic derivative reconstruction, stage
continuity, exterior power, terminal-factor bound, amplitude normalization,
quadrature refinement, and explicit failed hierarchy diagnostics.
