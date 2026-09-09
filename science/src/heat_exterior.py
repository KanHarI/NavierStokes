"""Float64 reference for the paper's exact heat-exterior family, not its core.

Equations A.32--A.37, OpenAI, Finite Time Blowup for Navier--Stokes.
No third-party numerical dependency and no upstream implementation code.
"""

import math
from functools import lru_cache

DEFAULT_H = 0.005


def simpson(function, start, end, intervals=512):
    if intervals < 2 or intervals % 2:
        raise ValueError("Simpson intervals must be positive and even")
    step = (end - start) / intervals
    terms = [function(start), function(end)]
    terms.extend((4 if i % 2 else 2) * function(start + i * step)
                 for i in range(1, intervals))
    return math.fsum(terms) * step / 3


@lru_cache(maxsize=32)
def quadrature(h=DEFAULT_H, intervals=512):
    if not 0 < h < 0.01:
        raise ValueError("Require 0 < h < 0.01; this does not certify assembled parameters")
    if intervals < 2 or intervals % 2:
        raise ValueError("Quadrature intervals must be positive and even")
    # v=exp(w) makes the fractional-power endpoint smooth. Omitted low-v
    # mass is bounded by exp(-36*(1+h))/((1+h)*Gamma(1+h)); high-v tail
    # begins at v=80. These are below float64 rounding for our h.
    low, high = -36.0, math.log(80)
    step = (high - low) / intervals
    result = []
    for i in range(intervals + 1):
        w = low + i * step
        v = math.exp(w)
        weight = (1 if i in (0, intervals) else 4 if i % 2 else 2)
        weight *= step / (3 * math.gamma(1 + h))
        result.append((v, weight * math.exp(-v + (h + 1) * w)))
    return tuple(result)


def heat_factor(argument, h=DEFAULT_H, derivative=0, intervals=512):
    """Evaluate H or H^(m) using the integral in A.32/A.34."""
    if not math.isfinite(argument) or argument < 0:
        raise ValueError("Heat factor argument must be finite and nonnegative")
    if derivative < 0 or not isinstance(derivative, int):
        raise ValueError("Derivative must be a nonnegative integer")
    factor = (-1) ** derivative * math.prod(h + i for i in range(derivative))
    return factor * math.fsum(weight * v ** derivative *
                              (1 + argument * v) ** (-h - derivative)
                              for v, weight in quadrature(h, intervals))


def velocity(x, y, z, time, h=DEFAULT_H, c_infinity=1.0):
    """Exact exterior formula on r>0,t<1; callers impose dataset domain.

    z is the cylinder axis. The formula is not extended to the singular axis.
    It is not asserted to match the paper's assembled core for these parameters.
    """
    if not all(math.isfinite(v) for v in (x, y, z, time, c_infinity)):
        raise ValueError("Coordinates and parameters must be finite")
    if time >= 1 or c_infinity <= 0:
        raise ValueError("Require t<1 and positive amplitude")
    radius = math.hypot(x, y)
    if radius == 0:
        raise ValueError("The exterior formula is unavailable on the axis")
    speed = c_infinity * (radius * radius / 2) ** (-0.5 - h)
    speed *= heat_factor(4 * (1 - time) / radius ** 2, h)
    return (-speed * y / radius, speed * x / radius, 0.0)


def pressure(radius, time, h=DEFAULT_H, c_infinity=1.0):
    """Pressure normalized to zero at radial infinity, per unit density.

    p=-integral_r^infinity K(a,t)^2/a da. The log-radius transform below
    integrates s from 0 to 36; the omitted normalized tail is < 2e-32.
    """
    if not math.isfinite(radius) or radius <= 0 or not math.isfinite(time) or time >= 1:
        raise ValueError("Require finite r>0 and t<1")
    a = 0.5 + h
    argument = 4 * (1 - time) / radius ** 2
    integral = simpson(lambda s: math.exp(-4 * a * s) *
                       heat_factor(argument * math.exp(-2 * s), h) ** 2,
                       0, 36, 2048)
    return -c_infinity ** 2 * (radius * radius / 2) ** (-2 * a) * integral


def similarity_coordinates(radius, z, time, h=DEFAULT_H):
    """Equation 3.2/4.1 transform, independent of any reconstructed profiles."""
    if not all(math.isfinite(v) for v in (radius, z, time, h)):
        raise ValueError("Coordinates must be finite")
    if radius < 0 or time >= 1 or not 0 < h < 0.01:
        raise ValueError("Require r>=0, t<1, and 0<h<0.01")
    tau, d = 1 - time, 0.5 - h
    low = max(tau, abs(z) ** (1 / d))
    high = max(2 * low, 1.0)
    while high - z * z * high ** (2 * h) < tau:
        high *= 2
    for _ in range(100):
        q = (low + high) / 2
        if q - z * z * q ** (2 * h) < tau:
            low = q
        else:
            high = q
    q = (low + high) / 2
    return q, z / q ** d, radius * radius / (2 * q)


def axis_comparison(argument):
    """Appendix B.11 scalar f^0 only; not a velocity approximation."""
    if not 0 <= argument <= 4.1:
        raise ValueError("Comparison checkpoint covers [0,4.1]")
    terms, term = [1.0], 1.0
    for n in range(1, 64):
        term *= -argument / (2 * n * (n + 1))
        terms.append(term)
        if abs(term) < 1e-18:
            break
    return math.fsum(terms)


def linear_sample(values, argument, maximum=16):
    if not 0 <= argument <= maximum or len(values) < 2:
        raise ValueError("Outside lookup coverage")
    coordinate = argument / maximum * (len(values) - 1)
    lower = min(int(coordinate), len(values) - 2)
    fraction = coordinate - lower
    return values[lower] * (1 - fraction) + values[lower + 1] * fraction
