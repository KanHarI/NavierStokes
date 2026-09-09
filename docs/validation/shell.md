# Soft spherical shell and particle replacement

Distance is `length(p - shipPosition) / shipScale`, independent of camera
orientation and perspective depth. The default optical response is:

| Distance in ship-scale units | Opacity | Additional boundary bokeh |
| --- | --- | --- |
| ≤ 1 | 0 | Invisible |
| 1 → 2 | Smoothly rises from 0 to 1 | Decreases to zero |
| 2 → 4 | 1 | Zero; ordinary focus defocus still applies |
| 4 → 5 | Smoothly falls from 1 to 0 | Increases |
| ≥ 5 | 0 | Invisible |

Focus is at 3× scale. The transition width and boundary bokeh are adjustable.
The normalized transition coordinate uses `S(x)=6x^5-15x^4+10x^3`, with zero
first and second derivatives at both endpoints. Opacity is `1-S`; additional
Gaussian standard deviation is `24*S` render-target pixels by default.
Gaussian variances add to the existing focus defocus variance. Their normalized
kernels preserve integrated light, followed by the intentional opacity attenuation.

The simulated pool extends another 0.25× scale beyond optical support: default
bounds are 0.75× to 5.25×. Ordinary recycled particles are accepted only where
the actual GPU spatial opacity is zero. The local core additionally admits
birth proposals in an invisible band just inside its true data boundary;
the velocity field is never extrapolated. Cropped field boundaries have their
own smooth opacity taper inside the valid domain, followed by an invisible
reservoir before the hard availability boundary.

Initial loading, explicit resets, and added density initialize new samples
with the existing temporal fade. An integration-budget replacement uses hidden
births. Local tracers still do not carry persistent global identities or certify
a globally uniform material-particle distribution. The particle cap remains
120,000, and the expanded transition/guard volume counts toward that budget.

Checks include CPU/GPU optical agreement at the boundary and transition points,
C2 endpoint continuity, monotonic fading, Gaussian light integration, and forced
ordinary recycling in both datasets with exactly zero GPU-measured birth opacity.
The existing Gaussian, overflow, and projection regression checks exercise the
same renderer with their explicit fixture shell settings.
