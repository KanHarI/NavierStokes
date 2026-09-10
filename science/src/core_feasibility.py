"""Sampled release gates for candidate Appendix B axis parameters.

These checks can reject an unresolved candidate. Passing them is numerical
evidence on the sampled patch, never certification of the existence theorem,
complex-neighborhood amplitude bound, or global annular matching.
"""

import math

from core_profiles import coefficients, _evaluate
from profile_parameters import (axis_log_amplitude, axis_peak_eta,
                                axis_quantities, parameter_diagnostics)


def axial_samples(parameters, uniform_count=25):
    """Include both the chi transition and the much narrower g peak."""
    if uniform_count < 3:
        raise ValueError("At least three uniform axial samples are required")
    peak = axis_peak_eta(parameters)
    h, e = parameters.h, peak
    slope = (.5-h) + 4*(1-e*e) - 2*e*(4*e+parameters.j0)
    transition_width = parameters.sigma / abs(slope)
    amplitude_width = parameters.sigma / math.sqrt(
        parameters.lambda_ * (1-2*h*e*e) * abs(slope))
    values = [-1+2*i/(uniform_count-1) for i in range(uniform_count)]
    values.extend(parameter_diagnostics(parameters)["Z_roots"])
    for width in (transition_width, amplitude_width):
        values.extend(peak+width*offset for offset in
                      (-16, -8, -4, -2, -1, -.5, -.25, 0, .25, .5, 1, 2, 4, 8, 16))
    return sorted(set(e for e in values if -1 <= e <= 1)), {
        "eta_H": peak,
        "chi_transition_width_estimate": transition_width,
        "g_peak_standard_deviation_estimate": amplitude_width,
        "uniform_eta_intervals_for_8_samples_per_g_sigma": math.ceil(16/amplitude_width),
    }


def normalized_sample(y, eta, parameters, order):
    """Evaluate B.15 without dividing by the potentially underflowed g.

    Angular balance is multiplied by Phi; its residual denominator is
    1+abs(the multiplied right-hand side). This remains meaningful when g
    rounds to zero, and does not pretend that zero is valid export precision.
    """
    phi, u, pressure, g, xi = coefficients(eta, parameters, order)
    value = lambda series, ry=0, re=0, avg=False: _evaluate(series, y, ry, re, avg)
    ph, uu = value(phi), value(u)
    ph_y, u_y = value(phi, 1), value(u, 1)
    h, lam = parameters.h, parameters.lambda_
    ell, d = 1-2*h*eta*eta, 1-eta*eta
    w = 1-2*(.5-h)*eta*value(u, avg=True)-d*value(u, re=1, avg=True)
    hc = (.5-h)*eta+d*uu
    angular_lhs = -2*ell*lam*(y*value(phi, 2)+2*ph_y)
    angular_rhs = (-w*(ph+y*ph_y)-h*(1-2*eta*uu)*ph
                   -hc*(value(phi, re=1)+xi.c[0]*ph))
    axial_lhs = -2*ell*lam*(y*value(u, 2)+u_y)
    axial_rhs = (-w*y*u_y-(.5+h)*(1-2*eta*uu)*uu-hc*value(u, re=1)
                 -d*value(pressure, re=1)+4*(.5+h)*eta*value(pressure)
                 +2*eta*y*value(pressure, 1))
    pressure_rhs = (g.c[0]*ph)**2
    pressure_lhs = lam*value(pressure, 1)
    residuals = [abs(a-b)/(1+abs(b)) for a, b in
                 ((angular_lhs, angular_rhs), (axial_lhs, axial_rhs),
                  (pressure_lhs, pressure_rhs))]
    result = {"Phi": ph, "U": uu, "Pi": value(pressure),
              "Phi_Y": ph_y, "U_Y": u_y,
              "max_normalized_residual": max(residuals),
              "angular_source": angular_rhs/ph if ph else None,
              "g_underflow": g.c[0] == 0}
    if not all(math.isfinite(v) for v in result.values() if v is not None):
        raise ArithmeticError("Nonfinite profile sample")
    return result


def check_candidate(parameters, orders=(18, 24, 32), uniform_count=25,
                    tolerance=1e-7):
    """Bounded refinement, positivity, and real-axis continuation screening."""
    if len(orders) < 2 or sorted(set(orders)) != list(orders):
        raise ValueError("Require at least two increasing distinct Taylor orders")
    etas, widths = axial_samples(parameters, uniform_count)
    radial = (0., .5, 1., 2., 3., 4., 4.1)
    max_changes = [0.]*(len(orders)-1)
    min_phi, max_residual = math.inf, 0.
    min_source_margin, min_endpoint = math.inf, math.inf
    min_endpoint_alternative = math.inf
    worst_source = None
    nonpositive_endpoint_p1 = []
    underflow, errors = set(), []
    for eta in etas:
        try:
            log_g = axis_log_amplitude(eta, parameters)
            for y in radial:
                samples = [normalized_sample(y, eta, parameters, order) for order in orders]
                for i, (coarse, fine) in enumerate(zip(samples, samples[1:])):
                    max_changes[i] = max(max_changes[i], *(abs(coarse[k]-fine[k])/(1+abs(fine[k]))
                                                         for k in ("Phi", "U", "Pi", "Phi_Y", "U_Y")))
                final = samples[-1]
                min_phi = min(min_phi, final["Phi"])
                max_residual = max(max_residual, final["max_normalized_residual"])
                if final["g_underflow"]:
                    underflow.add(eta)
                q = axis_quantities(eta, parameters)
                if final["angular_source"] is not None:
                    margin = final["angular_source"] - (2.5+.95*parameters.lambda_*q["L"]*q["chi"])
                    if margin < min_source_margin:
                        min_source_margin, worst_source = margin, {"eta": eta, "Y": y}
                if y == 4. and final["Phi"] > 0:
                    p1 = -2*y*final["Phi_Y"]/final["Phi"]
                    ns = -2*parameters.lambda_*final["U_Y"]
                    if p1 <= 0:
                        min_endpoint = -math.inf
                        min_endpoint_alternative = -math.inf
                        nonpositive_endpoint_p1.append(eta)
                    else:
                        log_term = (math.log(2/parameters.lambda_) + 2*math.log(abs(ns))
                                    - 2*log_g - 2*math.log(final["Phi"]) - math.log(p1)) if ns else -math.inf
                        endpoint = p1+math.exp(min(log_term, 690))-2
                        min_endpoint = min(min_endpoint, endpoint)
                        # Use B.3's sufficient angular-only alternative where
                        # chi>.99 instead of claiming a huge sampled gap caused
                        # by unresolved zeros of the axial source divided by g.
                        alternative = p1-2 if q["chi"] > .99 else endpoint
                        min_endpoint_alternative = min(min_endpoint_alternative, alternative)
        except (ArithmeticError, ValueError, OverflowError) as exc:
            errors.append({"eta": eta, "error": str(exc)})
    gate = parameter_diagnostics(parameters)
    sampled_core = (not errors and min_phi > 0 and max_changes[-1] <= tolerance
                    and max_residual <= tolerance)
    clean = lambda value: value if math.isfinite(value) else None
    return {
        "scope": "sampled real-axis core feasibility; not global or theorem certification",
        "axis_gate": gate, "sampling": {"eta_count": len(etas), "Y": radial,
                                          "orders": orders, **widths},
        "max_order_refinement_changes": max_changes,
        "minimum_Phi": clean(min_phi), "max_normalized_equation_residual": max_residual,
        "minimum_B17_source_margin": clean(min_source_margin),
        "minimum_B17_source_location": worst_source,
        "minimum_B19_endpoint_margin_above_2": clean(min_endpoint),
        "minimum_B19_sufficient_alternative_margin": clean(min_endpoint_alternative),
        "nonpositive_B19_p1_eta": nonpositive_endpoint_p1,
        "g_underflow_eta_count": len(underflow), "errors": errors,
        "sampled_core_resolved": sampled_core,
        "sampled_continuation_checks_pass": (sampled_core and gate["B2_sampled_condition"]
                                             and min_source_margin >= 0 and min_endpoint_alternative > .2),
        "browser_export_ready": False,
        "unresolved": ["complex-neighborhood C bound", "annular moment/stress matching",
                       "adaptive lookup and precision validation", "higher corrections"],
    }
