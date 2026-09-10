"""Numerical screening must resolve narrow peaks and detect bad truncations."""

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from core_feasibility import axial_samples, normalized_sample
from core_profiles import evaluate
from profile_parameters import AxisParameters, axis_peak_eta


class CoreFeasibilityTests(unittest.TestCase):
    def test_adaptive_samples_resolve_peak_missed_by_uniform_grid(self):
        parameters = AxisParameters(sigma=.0005, lambda_=1000, axis_amplitude=1e-8)
        etas, info = axial_samples(parameters)
        peak = axis_peak_eta(parameters)
        self.assertIn(peak, etas)
        self.assertGreater(sum(abs(e-peak) <= info["g_peak_standard_deviation_estimate"]*1.01
                               for e in etas), 5)
        self.assertLess(info["g_peak_standard_deviation_estimate"], 1e-5)
        self.assertGreater(info["uniform_eta_intervals_for_8_samples_per_g_sigma"], 1_000_000)

    def test_normalized_evaluator_agrees_when_g_is_representable(self):
        parameters = AxisParameters()
        for y, eta in ((0., -.2), (2., 0.), (4.1, .3)):
            safe = normalized_sample(y, eta, parameters, 22)
            direct = evaluate(y, eta, parameters, 22)
            for key in ("Phi", "U", "Pi"):
                self.assertAlmostEqual(safe[key], direct[key], places=14)
            self.assertLess(safe["max_normalized_residual"], 1e-9)

    def test_b2_sharpening_alone_is_not_a_convergent_radial_solve(self):
        parameters = AxisParameters(sigma=.0005)
        peak = axis_peak_eta(parameters)
        coarse = normalized_sample(4.1, peak, parameters, 12)
        fine = normalized_sample(4.1, peak, parameters, 24)
        self.assertGreater(abs(fine["Phi"]), 1e6*abs(coarse["Phi"]))
        self.assertGreater(fine["max_normalized_residual"], .1)

    def test_narrow_core_underflow_does_not_hide_normalized_equation_error(self):
        parameters = AxisParameters(sigma=.0005, lambda_=1000, axis_amplitude=1e-8)
        for eta in (axis_peak_eta(parameters), -.1, 1.):
            coarse = normalized_sample(4.1, eta, parameters, 18)
            fine = normalized_sample(4.1, eta, parameters, 24)
            self.assertGreater(fine["Phi"], .2)
            self.assertLess(fine["max_normalized_residual"], 1e-8)
            self.assertAlmostEqual(coarse["Phi"], fine["Phi"], delta=1e-9)
            self.assertTrue(all(math.isfinite(value) for value in fine.values()))
        self.assertTrue(fine["g_underflow"])


if __name__ == "__main__":
    unittest.main()
