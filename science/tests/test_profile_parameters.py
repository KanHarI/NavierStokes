"""Independent checks of the analytic local datum, not global admissibility."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from heat_exterior import simpson
from profile_parameters import (AxisParameters, axis_amplitude_at,
                                axis_log_amplitude, axis_peak_eta, axis_quantities,
                                parameter_diagnostics, pressure_datum,
                                pressure_datum_derivative, pressure_taylor)


class AxisParameterTests(unittest.TestCase):
    def test_pressure_is_exact_inner_radial_moment_shape(self):
        # A.5 inner branch E=P_* f exp(y/10), y<0 has pressure
        # -(5/2)P_*²f². This checks ONLY that contribution, not an outer tail.
        parameters = AxisParameters()
        p_star = math.sqrt(parameters.pressure_scale / 2.5)
        for eta in (-1., -.3, 0., .7, 1.):
            f = 1 / (1+eta*eta)
            numerical = -.5*simpson(lambda y: (p_star*f*math.exp(y/10))**2,
                                    -200, 0, 8192)
            self.assertAlmostEqual(pressure_datum(eta), numerical, delta=2e-10)

    def test_pressure_derivative_and_taylor_reconstruct_rational_datum(self):
        for eta in (-1., -.2, 0., .6, 1.):
            jet = pressure_taylor(eta, 12)
            self.assertAlmostEqual(jet[1], pressure_datum_derivative(eta), places=14)
            for offset in (-.025, .01):
                value = math.fsum(coefficient*offset**n for n, coefficient in enumerate(jet))
                self.assertAlmostEqual(value, pressure_datum(eta+offset), delta=3e-14)
            self.assertEqual(pressure_datum(eta), pressure_datum(-eta))
            if eta:
                self.assertGreater(eta*pressure_datum_derivative(eta), 0)

    def test_axis_normalization_and_log_derivative(self):
        parameters = AxisParameters()
        peak = axis_peak_eta(parameters)
        self.assertAlmostEqual(axis_quantities(peak)["H"], 0, delta=1e-16)
        self.assertAlmostEqual(axis_amplitude_at(peak), parameters.axis_amplitude, places=14)
        for eta in (-.9, -.1, 0., .2, .9):
            step = 1e-5
            numerical = (axis_log_amplitude(eta+step)-axis_log_amplitude(eta-step))/(2*step)
            self.assertAlmostEqual(numerical, parameters.lambda_*axis_quantities(eta)["zeta"],
                                   delta=2e-7)
            self.assertGreater(axis_amplitude_at(eta), 0)
            self.assertLessEqual(axis_amplitude_at(eta), parameters.axis_amplitude)

    def test_finite_defaults_do_not_claim_admissible_global_schedule(self):
        report = parameter_diagnostics()
        self.assertGreater(report["minimum_negative_W_sampled"], 2.8)
        self.assertGreater(report["Z_at_H_zero"], 0)
        self.assertGreater(report["log_C"], 0)
        self.assertFalse(report["B2_sampled_condition"])
        # An exact Z root witnesses failure even without the threshold sampling.
        root = min(report["Z_roots"], key=abs)
        self.assertAlmostEqual(axis_quantities(root)["Z"], 0, delta=1e-13)
        self.assertLess(axis_quantities(root)["chi"], .01)
        self.assertFalse(report["global_matching_certified"])
        self.assertFalse(report["analytic_convergence_threshold_certified"])

    def test_finite_sharper_sigma_meets_sampled_b2_gap_only(self):
        # Concrete diagnostic of the parameter gate; this deliberately does
        # not promote a sampled gap to a global gluing or existence certificate.
        report = parameter_diagnostics(AxisParameters(sigma=.0005))
        self.assertTrue(report["B2_sampled_condition"])
        self.assertGreater(report["minimum_chi_near_Z_zero_sampled"], .997)
        self.assertFalse(report["global_matching_certified"])

    def test_narrow_amplitude_quadrature_resolves_endpoints(self):
        parameters = AxisParameters(sigma=.0005, lambda_=1000.)
        peak = axis_peak_eta(parameters)
        values = [axis_log_amplitude(eta, parameters) for eta in (-1., peak, 0., 1.)]
        self.assertTrue(all(math.isfinite(value) for value in values))
        self.assertEqual(values[1], math.log(parameters.axis_amplitude))
        for eta in (-.9, -.02, .02, .9):
            step = 1e-7
            measured = (axis_log_amplitude(eta+step, parameters)-axis_log_amplitude(eta-step, parameters))/(2*step)
            expected = parameters.lambda_*axis_quantities(eta, parameters)['zeta']
            self.assertAlmostEqual(measured/expected, 1., delta=2e-7)

    def test_core_uses_the_entire_selected_outer_pressure_datum(self):
        from outer_schedule import OuterScheduleParameters, pressure_taylor as outer_taylor
        from core_profiles import coefficients, evaluate
        schedule = OuterScheduleParameters()
        parameters = AxisParameters(outer_schedule=schedule)
        for eta in (-.6, 0., .6):
            pressure = coefficients(eta, parameters, 18)[2][0]
            self.assertEqual(pressure.c, tuple(outer_taylor(eta, 21, schedule)))
            actual = evaluate(1., eta, parameters, 22)
            self.assertLess(actual['angular_relative_residual'], 1e-7)
            self.assertLess(actual['axial_relative_residual'], 1e-7)
        with self.assertRaisesRegex(ValueError, 'same h'):
            AxisParameters(h=.001, outer_schedule=schedule)


if __name__ == "__main__":
    unittest.main()
