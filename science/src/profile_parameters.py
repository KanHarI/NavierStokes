"""Diagnostic axis data for Appendix B.1, separate from global matching.

The analytic pressure family obeys the local sign hypotheses in B.1. Its
coefficient is not obtained from the complete Appendix A outer schedule.
Finite defaults solve the local equations only: they do NOT certify B.2/B.3
or the annular gluing assumptions of the source construction.
"""

from dataclasses import dataclass
from functools import lru_cache
import math


@dataclass(frozen=True)
class AxisParameters:
    h: float = .005
    j0: float = .025
    pressure_scale: float = 4.0
    sigma: float = .5
    lambda_: float = 16.0
    axis_amplitude: float = .25

    def __post_init__(self):
        if not all(math.isfinite(value) for value in self.__dict__.values()):
            raise ValueError("Axis parameters must be finite")
        if not 0 < self.h < .01 or not 0 < self.j0 <= .05:
            raise ValueError("Require 0<h<.01 and 0<j0<=.05")
        if min(self.pressure_scale, self.sigma, self.axis_amplitude) <= 0:
            raise ValueError("Pressure scale, sigma, and axis amplitude must be positive")
        if self.lambda_ < 1:
            raise ValueError("Require lambda_>=1")


DEFAULT_PARAMETERS = AxisParameters()


def pressure_datum(eta, parameters=DEFAULT_PARAMETERS):
    """Pi_0=-P/(1+eta²)²; P is a coefficient, not the paper's P_* ."""
    return -parameters.pressure_scale / (1 + eta * eta) ** 2


def pressure_datum_derivative(eta, parameters=DEFAULT_PARAMETERS):
    return 4 * parameters.pressure_scale * eta / (1 + eta * eta) ** 3


def pressure_taylor(eta, order, parameters=DEFAULT_PARAMETERS):
    """Exact rational recurrence for coefficients of Pi_0(eta+epsilon)."""
    if not isinstance(order, int) or order < 0:
        raise ValueError("Taylor order must be a nonnegative integer")
    a = 1 + eta * eta
    denominator = (a*a, 4*a*eta, 2+6*eta*eta, 4*eta, 1.)
    coefficients = [-parameters.pressure_scale / denominator[0]]
    for n in range(1, order+1):
        coefficients.append(-math.fsum(denominator[k] * coefficients[n-k]
                                      for k in range(1, min(n, 4)+1)) / denominator[0])
    return coefficients


def axis_quantities(eta, parameters=DEFAULT_PARAMETERS):
    """B.1/B.3 scalar data; derivatives of U_* and Pi_0 are analytic."""
    h = parameters.h
    a, d_exponent = .5+h, .5-h
    d, length = 1-eta*eta, 1-2*h*eta*eta
    u = 4*eta+parameters.j0
    transport = d_exponent*eta+d*u
    w = 1-4*d-2*d_exponent*eta*u
    pressure = pressure_datum(eta, parameters)
    z = (-a*(1-2*eta*u)*u-4*transport
         -d*pressure_datum_derivative(eta, parameters)+4*a*eta*pressure)
    denominator = transport*transport+parameters.sigma**2
    return {"U": u, "H": transport, "W": w, "Z": z, "L": length,
            "chi": transport*transport/denominator,
            "zeta": -length*transport/denominator, "pressure": pressure}


def _bisect(function, low, high):
    left = function(low)
    for _ in range(60):
        mid = (low+high)/2
        value = function(mid)
        if value == 0:
            return mid
        if (value > 0) == (left > 0):
            low, left = mid, value
        else:
            high = mid
    return (low+high)/2


@lru_cache(maxsize=64)
def axis_peak_eta(parameters=DEFAULT_PARAMETERS):
    """Unique zero of H_* in [-1,1], where the positive g is maximal."""
    return _bisect(lambda eta: axis_quantities(eta, parameters)["H"], -1., 0.)


def _integral(function, low, high, tolerance=2e-13):
    if high < low:
        return -_integral(function, high, low, tolerance)
    if high == low:
        return 0.
    a, b, c = function(low), function((low+high)/2), function(high)
    whole = (high-low)*(a+4*b+c)/6

    def refine(lo, hi, fa, fm, fb, estimate, tol, depth):
        mid = (lo+hi)/2
        fl, fr = function((lo+mid)/2), function((mid+hi)/2)
        left = (mid-lo)*(fa+4*fl+fm)/6
        right = (hi-mid)*(fm+4*fr+fb)/6
        error = left+right-estimate
        if abs(error) <= 15*tol:
            return left+right+error/15
        if depth == 0:
            raise ArithmeticError("Axis amplitude quadrature did not converge")
        return (refine(lo, mid, fa, fl, fm, left, tol/2, depth-1)
                +refine(mid, hi, fm, fr, fb, right, tol/2, depth-1))

    return refine(low, high, a, b, c, whole, tolerance, 28)


def axis_log_amplitude(eta, parameters=DEFAULT_PARAMETERS):
    """log(g), with g=phi_*/C and its maximum fixed by axis_amplitude.

    A log representation avoids underflow for more concentrated diagnostic
    choices. The integral is referenced to H_*=0 to avoid cancellation.
    """
    if not math.isfinite(eta) or not -1 <= eta <= 1:
        raise ValueError("Axis amplitude is available for finite eta in [-1,1]")
    integral = _integral(lambda e: axis_quantities(e, parameters)["zeta"],
                         axis_peak_eta(parameters), eta)
    return math.log(parameters.axis_amplitude)+parameters.lambda_*integral


def axis_amplitude_at(eta, parameters=DEFAULT_PARAMETERS):
    return math.exp(axis_log_amplitude(eta, parameters))


def parameter_diagnostics(parameters=DEFAULT_PARAMETERS, samples=4001):
    """Numerical checks, never a certificate of the global construction.

    Testing B.2 at Z_*=0 gives an unambiguous failure witness when present.
    Sampling can provide evidence of a gap, not a rigorous interval proof.
    """
    if samples < 3:
        raise ValueError("At least three diagnostic samples are required")
    peak = axis_peak_eta(parameters)
    peak_data = axis_quantities(peak, parameters)
    delta = abs(peak_data["Z"])/4
    grid = [-1+2*i/(samples-1) for i in range(samples)]
    data = [axis_quantities(eta, parameters) for eta in grid]
    roots = []
    for left, right, a, b in zip(grid, grid[1:], data, data[1:]):
        if a["Z"] == 0:
            roots.append(left)
        elif a["Z"]*b["Z"] < 0:
            roots.append(_bisect(lambda e: axis_quantities(e, parameters)["Z"], left, right))
    near_zero = [q["chi"] for q in data if abs(q["Z"]) <= delta]
    near_zero.extend(axis_quantities(eta, parameters)["chi"] for eta in roots)
    # Resolve the narrow threshold boundaries as well as the exact Z zeros;
    # otherwise a fixed grid can greatly overestimate the minimum chi.
    for threshold in (-delta, delta):
        for left, right, a, b in zip(grid, grid[1:], data, data[1:]):
            if (a["Z"]-threshold)*(b["Z"]-threshold) < 0:
                boundary = _bisect(lambda e: axis_quantities(e, parameters)["Z"]-threshold,
                                   left, right)
                near_zero.append(axis_quantities(boundary, parameters)["chi"])
    minimum_chi = min(near_zero) if near_zero else None
    return {
        "scope": "local analytic axis datum; outer pressure and moments unmatched",
        "h_root_eta": peak,
        "Z_at_H_zero": peak_data["Z"],
        "minimum_negative_W_sampled": min(-q["W"] for q in data),
        "B2_delta": delta,
        "Z_roots": roots,
        "minimum_chi_near_Z_zero_sampled": minimum_chi,
        "B2_sampled_condition": minimum_chi is not None and minimum_chi > .99,
        "log_C": -axis_log_amplitude(0., parameters),
        "global_matching_certified": False,
        "analytic_convergence_threshold_certified": False,
    }
