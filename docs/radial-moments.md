# Five-moment matching on a finite annulus

`science/src/radial_moments.py` integrates the five cumulative radial
functions in (4.15) of the
[source paper](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf)
and solves small finite corrections using the quadratic moment map of
Lemma A.2 and Corollary A.3. This is an offline matching tool. It has not
assembled the displayed core and the complete outer construction.

## The quantities that must agree

For `H=sqrt(2X)E`, the five densities are

| Function | Radial density |
| --- | --- |
| M | U |
| I | H |
| J | U H |
| S | U² − E²/2 |
| Cp | E²/(2X) |

Their integrals extend from the axis to the joining radius. The pressure is
`Pi=Pi0+Cp`, so both constructions must use the same axis datum Pi0 when
comparing pressure increments. Integrating a declared annulus is sufficient
for a compact edit only when all other contributions have already been
accounted for in the discrepancy.

`moments(profile, knots, order)` accepts a callable returning `(U,E)` and
radial knots that split every transition. Gauss–Legendre quadrature samples
inside each interval; a knot at zero is permitted when the actual profile
has integrable axis behavior. Merely excluding the endpoint from quadrature
does not make a singular, nonintegrable profile valid.

The signed input to `MomentCorrection.solve` is **target minus current** in
the original physical moment units. For example, a negative Cp discrepancy
requests a decrease in the radial pressure increment, subject to the
smallness and positive-swirl checks.

## Correction and normalization

Five ordered disjoint intervals away from the axis support two additive U
bumps and three additive E bumps. Each bump is positive inside its interval,
has unit peak, and vanishes to every order at its endpoints. Their shape is
a numerical choice allowed by Lemma A.1; it is not the particular sigma-prime
shape used for some later stages of the source's outer schedule.

For coefficients c, the change in moments is exactly quadratic:

```text
F(c) = B c + Q(c,c).
```

Disjoint supports remove cross terms between different bumps, including the
U/E product in J. The implementation integrates the linear and quadratic
coefficients directly from the actual base profile. It therefore does not
assume that a corrected U remains constant or that a generic base profile
is a power law. A noninvertible or poorly resolved Jacobian is rejected.

The optional five positive `row_scales` divide the moment equations and
their discrepancies before solving. For a rescaling `X=rho*x`, the natural
geometric factors from (A.4) are

```text
(rho, rho^(3/2), rho^(3/2), rho, 1).
```

Additional amplitude normalizations can be useful. The caller must choose
and record meaningful scales for its field; the defaults are all one.
Changing row scales does not change the physical equations, but can change
conditioning, floating-point accuracy, and the conservatism of the
smallness bound. The returned refined residuals are in the original
physical moment units.

## Why some requested corrections are rejected

With infinity norms, the code computes numerical estimates
`beta=||B^(-1)||`, `kappa=||Q||`, and `d=||discrepancy||` for the scaled rows.
It accepts only

```text
8 beta² kappa d <= 1.
```

Iteration starts from zero with `c <- B^(-1)[d-Q(c,c)]`, following Lemma A.2.
The result must stay inside its predicted ball `||c||<=2 beta d`.
The implementation also checks positive E at refined quadrature points
and independently reintegrates the corrected fields at twice the
construction quadrature order. A large requested edit, singular Jacobian,
failed iteration, sampled negative E, or failed refinement check raises an
error. It is not silently converted into a large compensating swirl.

These are floating-point diagnostics. The inverse norm is not a rigorous
roundoff enclosure; the positivity check samples rather than bounds the
whole interval. Quadrature refinement provides numerical evidence but
cannot certify an unresolved transition. In particular, residual accuracy
must be compared with the physical discrepancy and chosen row scales.

## What this establishes, and what remains

The tests compare power-law moments with closed-form integrals and verify
that a small compact modification can have all five integral discrepancies
restored. Large and degenerate cases are rejected. This is more than
matching only the pressure increment, but it remains a finite annular test.

Lemma 4.4 restores the outer radial velocity, pressure, and integrated
stresses when both profiles rejoin beyond a radius and **all five moment
functions agree there for every eta**, with the same Pi0. The present tool
solves a specified eta slice. It does not establish uniform invertibility
or the C^k estimates (A.3), nor matching eta derivatives, nor the strict
stress-cone inequalities after correction. The result explicitly reports
`parameterDerivativesCertified=false` and `stressConeCertified=false`.

Before this can replace the displayed join, the core/reference profiles must
be resolved through their overlap, discrepancies measured across eta,
appropriate correction intervals and normalization selected, smooth
coefficient dependence and its derivatives checked, and the stress gaps
verified. The separate outer pulse and angular closures, heat replacement,
and higher corrective fields also remain necessary. Successful correction
of a small numerical example does not establish the complete
smooth-forcing construction.
