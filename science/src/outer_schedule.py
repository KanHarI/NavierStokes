"""Finite log-radius realization of the Appendix A azimuthal schedule.

Implements A.7--A.13 and the pressure integral A.21, omitting the angular
bumps whose *total pressure increment is zero*. This is not a completed
outer flow: the axial pulse amplitude, M/J/S matching, stress cones, heat
replacement, and the theorem's nested smallness choices are not certified.
All radii are stored as log(X/X_R), so the schedule need not fit in float64
physical coordinates. Only Python's standard library is required.
"""

from dataclasses import dataclass
from functools import lru_cache
import math

from heat_exterior import simpson


@dataclass(frozen=True)
class OuterScheduleParameters:
    h: float = .005
    m_d: float = 2.
    p_star: float = 1.
    lambda_: float = .08
    interpolation_length: float = 30.
    terminal_coefficient: float = .005

    def __post_init__(self):
        if not all(math.isfinite(value) for value in self.__dict__.values()):
            raise ValueError("Outer schedule parameters must be finite")
        if not 0 < self.h < .01 or not self.h < self.lambda_ < .25:
            raise ValueError("Require 0<h<.01 and h<lambda<.25")
        if not 0 < self.m_d <= 10 or not 0 < self.p_star < 1e150:
            raise ValueError("Require 0<M_d<=10 and 0<P_*<1e150 for finite evaluation")
        if self.interpolation_length < 30 or not 0 < self.terminal_coefficient <= .01:
            raise ValueError("Require T_f>=30 and 0<c_o<=.01")


DEFAULT_SCHEDULE = OuterScheduleParameters()


def smooth_step(value):
    """The source's flat C-infinity step (A.5), evaluated without overflow."""
    if value <= 0:
        return 0.
    if value >= 1:
        return 1.
    exponent = 1/value**2 - 1/(1-value)**2
    if exponent >= 0:
        small = math.exp(-exponent)
        return small/(1+small)
    small = math.exp(exponent)
    return 1/(1+small)


def smooth_step_derivative(value):
    if value <= 0 or value >= 1:
        return 0.
    step = smooth_step(value)
    return step*(1-step)*(2/value**3+2/(1-value)**3)


@lru_cache(maxsize=8192)
def _step_integral(value):
    if value <= 0:
        return 0.
    if value >= 1:
        return value-.5
    return simpson(smooth_step, 0, value, 256)


@dataclass(frozen=True)
class _Segment:
    name: str
    start: float
    length: float
    log_c: float
    l0: float
    l1: float
    theta: float
    kind: str = "slope"

    def value(self, local_y, parameters):
        if self.kind == "interpolation":
            theta = 1-smooth_step(local_y/self.length)
            return (self.log_c-(.5+parameters.lambda_)*local_y
                    -(1-theta)*math.log(2), theta)
        if self.kind == "terminal":
            rho = parameters.terminal_coefficient*parameters.h
            f = 1-rho+rho*smooth_step((local_y-1)/2)
            return (self.log_c-(.5+parameters.h)*local_y
                    +math.log(f/(1-rho)), 0.)
        return (self.log_c+(self.l0-.5)*local_y
                +(self.l1-self.l0)*_step_integral(local_y), self.theta)


def _q_transition(q, l0, l1, h, intervals=1024):
    """A.13 auxiliary ODE on a unit slope-transition interval, RK4."""
    step = 1/intervals

    def derivative(y, value):
        slope = l0+(l1-l0)*smooth_step(y)
        return -(1+slope)*value-slope-h

    for i in range(intervals):
        y = i*step
        a = derivative(y, q)
        b = derivative(y+step/2, q+step*a/2)
        c = derivative(y+step/2, q+step*b/2)
        d = derivative(y+step, q+step*c)
        q += step*(a+2*b+2*c+d)/6
    return q


@lru_cache(maxsize=32)
def schedule_segments(parameters=DEFAULT_SCHEDULE):
    """All finite A.2 stages, followed by the infinite exterior power tail."""
    segments = []
    y, log_c = 0., math.log(parameters.p_star)

    def add(name, length, l0, l1=None, theta=1., kind="slope"):
        nonlocal y, log_c
        piece = _Segment(name, y, length, log_c, l0,
                         l0 if l1 is None else l1, theta, kind)
        segments.append(piece)
        log_c, _ = piece.value(length, parameters)
        y += length

    h, lam = parameters.h, parameters.lambda_
    add("axial reduction ramp", 1., .6, 0.)
    add("axial reduction", math.exp(parameters.m_d)+10, 0.)
    add("intermediate ramp", 1., 0., -lam)
    add("intermediate power", 60*math.log(1/lam), -lam)
    add("axial pulse", 13/lam, -lam)
    add("profile interpolation", parameters.interpolation_length, -lam,
        kind="interpolation")
    add("angular correction interval (pressure-neutral bumps omitted)",
        30*math.log(1/lam), -lam, theta=0.)
    add("exterior release ramp", 1., -lam, -1., theta=0.)
    hold = 4*math.log(1/h)
    add("exterior release hold", hold, -1., theta=0.)
    add("exterior recovery ramp", 1., -1., -h, theta=0.)
    # The preceding pressure-neutral correction sets Q=(lambda-h)/(1-lambda).
    # Its E bumps can be omitted for A.21, but this corrected Q datum must be
    # used to determine the unchanged subsequent transition lengths (A.13).
    q = _q_transition((lam-h)/(1-lam), -lam, -1., h)
    q += (1-h)*hold
    q = _q_transition(q, -1., -h, h)
    rho = parameters.terminal_coefficient*h
    qp = rho/(1-rho)*simpson(
        lambda v: math.exp((1-h)*v)*smooth_step_derivative((v-1)/2)/2,
        1, 3, 512)
    wait = math.log(q/qp)/(1-h)
    if not math.isfinite(wait) or wait <= 0:
        raise ArithmeticError("No positive terminal waiting interval for this schedule")
    add("terminal waiting interval", wait, -h, theta=0.)
    add("terminal transition", 3., -h, theta=0., kind="terminal")
    segments.append(_Segment("infinite exterior power", y, math.inf, log_c,
                             -h, -h, 0.))
    return tuple(segments)


def log_profile(log_radius, eta, parameters=DEFAULT_SCHEDULE):
    """log E for the pressure reference E_id,sched, not the corrected flow."""
    if not math.isfinite(log_radius) or not math.isfinite(eta):
        raise ValueError("Log radius and eta must be finite")
    if log_radius <= 0:
        return math.log(parameters.p_star)+log_radius/10-math.log1p(eta*eta)
    for piece in schedule_segments(parameters):
        if log_radius <= piece.start+piece.length:
            log_c, theta = piece.value(log_radius-piece.start, parameters)
            return log_c-theta*math.log1p(eta*eta)
    raise AssertionError("Infinite tail must cover every finite log radius")


@lru_cache(maxsize=64)
def pressure_measure(parameters=DEFAULT_SCHEDULE, intervals=256):
    """Positive (weight, power) terms for -Pi0=sum w*(1+eta²)^(-power).

    Integrate constant-slope pieces and both infinite tails analytically.
    Simpson quadrature is confined to smooth finite transitions. The two
    common powers (0,2) are coalesced; interpolation powers remain explicit.
    """
    if not isinstance(intervals, int) or intervals < 16 or intervals % 2:
        raise ValueError("Use an even number of quadrature intervals >=16")
    result = [(2.5*parameters.p_star**2, 2.)]
    for piece in schedule_segments(parameters):
        rate = 2*(piece.l0-.5)
        if piece.kind == "slope" and piece.l0 == piece.l1:
            fraction = (1. if math.isinf(piece.length)
                        else -math.expm1(rate*piece.length))
            result.append((.5*math.exp(2*piece.log_c)*fraction/(-rate),
                           2*piece.theta))
        else:
            step = piece.length/intervals
            for i in range(intervals+1):
                c, theta = piece.value(i*step, parameters)
                factor = 1 if i in (0, intervals) else 4 if i % 2 else 2
                result.append((factor*step*math.exp(2*c)/6, 2*theta))
    common = [(math.fsum(w for w, p in result if p == power), power)
              for power in (0., 2.)]
    return tuple(common+[(w, p) for w, p in result if p not in (0., 2.)])


def pressure_datum(eta, parameters=DEFAULT_SCHEDULE):
    if not math.isfinite(eta):
        raise ValueError("eta must be finite")
    return -math.fsum(w*(1+eta*eta)**(-p) for w, p in pressure_measure(parameters))


def pressure_derivative(eta, parameters=DEFAULT_SCHEDULE):
    if not math.isfinite(eta):
        raise ValueError("eta must be finite")
    return math.fsum(2*p*eta*w*(1+eta*eta)**(-p-1)
                     for w, p in pressure_measure(parameters))


def pressure_taylor(eta, order, parameters=DEFAULT_SCHEDULE):
    """Analytic eta Taylor coefficients of A.21, with quadrature in radius.

    If F=(1+eta²)^(-p), (1+eta²)F'=-2p eta F gives this
    three-term recurrence; no differencing of pressure samples is used.
    """
    if not math.isfinite(eta) or not isinstance(order, int) or order < 0:
        raise ValueError("Require finite eta and nonnegative integer Taylor order")
    rows = []
    a = 1+eta*eta
    for weight, power in pressure_measure(parameters):
        c = [-weight*a**(-power)]
        for n in range(order):
            previous = c[n-1] if n else 0.
            c.append((-2*eta*(n+power)*c[n]
                      -(n-1+2*power)*previous)/(a*(n+1)))
        rows.append(c)
    return [math.fsum(row[n] for row in rows) for n in range(order+1)]


def schedule_diagnostics(parameters=DEFAULT_SCHEDULE):
    pieces = schedule_segments(parameters)
    td = math.exp(parameters.m_d)+10
    weights = pressure_measure(parameters)
    refined = pressure_measure(parameters, 512)
    coarse_p = -math.fsum(w for w, _ in weights)
    refined_p = -math.fsum(w for w, _ in refined)
    return {
        "scope": "A.21 pressure from finite unedited azimuthal schedule; outer flow unmatched",
        "T_d": td,
        "log_P_star": math.log(parameters.p_star),
        "A6_P_star_greater_than_exp_Td": math.log(parameters.p_star) > td,
        "A6_h_less_than_exp_minus_Td": math.log(parameters.h) < -td,
        "h_over_lambda": parameters.h/parameters.lambda_,
        "unspecified_smallness_thresholds_certified": False,
        "log_exterior_start_over_X_R": pieces[-1].start,
        "axis_pressure_at_zero": coarse_p,
        "inner_pressure_at_zero": -2.5*parameters.p_star**2,
        "outer_pressure_fraction": 1-2.5*parameters.p_star**2/(-coarse_p),
        "pressure_quadrature_refinement_absolute": abs(coarse_p-refined_p),
        "global_matching_certified": False,
        "pressure_neutral_angular_bumps_implemented": False,
        "axial_pulse_moment_closure_implemented": False,
        "stress_cone_certified": False,
        "stages": [{"name": p.name, "log_start": p.start,
                    "log_length": None if math.isinf(p.length) else p.length}
                   for p in pieces],
    }
