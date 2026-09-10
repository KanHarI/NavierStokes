"""Independent pressure integration and finite-schedule source identities."""

from dataclasses import replace
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from heat_exterior import simpson
from outer_schedule import (DEFAULT_SCHEDULE, OuterScheduleParameters,
                            log_profile, pressure_datum, pressure_derivative,
                            pressure_taylor, schedule_diagnostics,
                            schedule_segments, smooth_step,
                            smooth_step_derivative)


class OuterScheduleTests(unittest.TestCase):
    def test_pressure_agrees_with_independent_log_radius_integral(self):
        # Integrate the actual E evaluator, not the weighted-power pressure
        # representation. Exponential tails are bounded by their exact forms.
        parameters = DEFAULT_SCHEDULE
        pieces = schedule_segments(parameters)
        for eta in (0., .3, 1.):
            total = simpson(lambda y: math.exp(2*log_profile(y, eta, parameters)),
                            -240, 0, 8192)
            for piece in pieces[:-1]:
                total += simpson(
                    lambda y: math.exp(2*log_profile(y, eta, parameters)),
                    piece.start, piece.start+piece.length, 2048)
            tail = pieces[-1]
            total += math.exp(2*log_profile(tail.start, eta, parameters))/(1+2*parameters.h)
            self.assertAlmostEqual(pressure_datum(eta, parameters), -.5*total,
                                   delta=3e-11)

    def test_pressure_sign_amplitude_scaling_and_analytic_derivatives(self):
        baseline = DEFAULT_SCHEDULE
        doubled = replace(baseline, p_star=2*baseline.p_star)
        for eta in (-1., -.3, 0., .7, 1.):
            value = pressure_datum(eta)
            self.assertLess(value, -2.5/(1+eta*eta)**2)
            self.assertEqual(value, pressure_datum(-eta))
            self.assertAlmostEqual(pressure_datum(eta, doubled), 4*value, delta=2e-14)
            coefficients = pressure_taylor(eta, 16)
            self.assertAlmostEqual(coefficients[1], pressure_derivative(eta), delta=2e-14)
            if eta:
                self.assertGreater(eta*pressure_derivative(eta), 0)
            for offset in (-.02, .01):
                series = math.fsum(c*offset**i for i, c in enumerate(coefficients))
                self.assertAlmostEqual(series, pressure_datum(eta+offset), delta=4e-14)
            delta = 1e-5
            derivative = (pressure_datum(eta+delta)-pressure_datum(eta-delta))/(2*delta)
            self.assertAlmostEqual(derivative, pressure_derivative(eta), delta=1e-9)

    def test_stage_junctions_are_continuous_and_exterior_has_source_power(self):
        parameters = DEFAULT_SCHEDULE
        pieces = schedule_segments(parameters)
        for eta in (-1., 0., .4):
            for piece in pieces:
                boundary = piece.start
                delta = 1e-7
                self.assertLess(abs(log_profile(boundary-delta, eta)
                                    -log_profile(boundary+delta, eta)), 4e-7)
            tail = pieces[-1].start
            self.assertAlmostEqual(log_profile(tail+3, eta)-log_profile(tail, eta),
                                   -3*(.5+parameters.h), delta=1e-12)
            self.assertAlmostEqual(log_profile(tail, eta), log_profile(tail, 0), delta=1e-12)

    def test_terminal_factor_has_source_smallness_bound(self):
        # A.12 requires 0 <= f_o'/f_o < h/4, independently of the
        # much stronger global A.6 inequalities that this candidate fails.
        for co in (.005, .01):
            h = .005
            ratios = []
            for i in range(1001):
                y = 3*i/1000
                f = 1-co*h+co*h*smooth_step((y-1)/2)
                ratios.append(co*h*smooth_step_derivative((y-1)/2)/(2*f))
            self.assertGreaterEqual(min(ratios), 0)
            self.assertLess(max(ratios), h/4)

    def test_full_pressure_is_not_only_inner_branch_and_diagnostics_are_honest(self):
        report = schedule_diagnostics()
        self.assertAlmostEqual(report["axis_pressure_at_zero"], -3.314622729224217, delta=2e-11)
        self.assertGreater(report["outer_pressure_fraction"], .24)
        self.assertLess(report["pressure_quadrature_refinement_absolute"], 2e-11)
        self.assertGreater(report["log_exterior_start_over_X_R"], 400)
        self.assertFalse(report["A6_P_star_greater_than_exp_Td"])
        self.assertFalse(report["A6_h_less_than_exp_minus_Td"])
        self.assertFalse(report["global_matching_certified"])
        self.assertFalse(report["stress_cone_certified"])
        scale = math.sqrt(4/-pressure_datum(0))
        normalized = replace(DEFAULT_SCHEDULE, p_star=scale)
        self.assertAlmostEqual(pressure_datum(0, normalized), -4, delta=2e-14)

    def test_invalid_diagnostic_parameters_are_rejected(self):
        for kwargs in ({"h": .1}, {"lambda_": .005}, {"p_star": 0},
                       {"m_d": math.inf}, {"terminal_coefficient": .5}):
            with self.assertRaises(ValueError):
                OuterScheduleParameters(**kwargs)

    def test_explicit_hierarchy_inequalities_can_pass_without_certifying_theorem(self):
        td = math.exp(2)+10
        parameters = OuterScheduleParameters(
            h=math.exp(-td-1), p_star=math.exp(td+1), lambda_=.02)
        report = schedule_diagnostics(parameters)
        self.assertTrue(report["A6_P_star_greater_than_exp_Td"])
        self.assertTrue(report["A6_h_less_than_exp_minus_Td"])
        self.assertTrue(math.isfinite(report["axis_pressure_at_zero"]))
        self.assertLess(report["axis_pressure_at_zero"], -1e16)
        self.assertFalse(report["unspecified_smallness_thresholds_certified"])
        self.assertFalse(report["global_matching_certified"])


if __name__ == "__main__":
    unittest.main()
