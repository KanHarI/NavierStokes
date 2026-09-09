"""Independent physical-coordinate checks of the local diagnostic core.

These test the real profile, not an illustrative replacement or a force
defined only by the same differencing operation being tested.
"""

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from core_profiles import evaluate, velocity
from heat_exterior import similarity_coordinates
from profile_parameters import AxisParameters

PARAMETERS = AxisParameters()


def _shift(point, axis, amount):
    moved = list(point)
    moved[axis] += amount
    return moved


def _pressure(point, time):
    radius = math.hypot(*point[:2])
    q, eta, x = similarity_coordinates(radius, point[2], time, PARAMETERS.h)
    return q ** (-1-2*PARAMETERS.h) * evaluate(PARAMETERS.lambda_*x, eta)["Pi"]


def _physical_residual(point, time, step):
    """Cartesian central differences of every term in NSE, without Z/T ops."""
    center = velocity(*point,time)
    before, after = velocity(*point,time-step), velocity(*point,time+step)
    residual = [(after[i]-before[i])/(2*step) for i in range(3)]
    for axis in range(3):
        left, right = _shift(point,axis,-step), _shift(point,axis,step)
        u_left, u_right = velocity(*left,time), velocity(*right,time)
        for component in range(3):
            residual[component] += center[axis]*(u_right[component]-u_left[component])/(2*step)
            residual[component] -= (u_right[component]-2*center[component]+u_left[component])/step**2
        residual[axis] += (_pressure(right,time)-_pressure(left,time))/(2*step)
    return residual


class CorePhysicalTests(unittest.TestCase):
    def test_cartesian_divergence_converges_including_axis(self):
        for point,time in (((.05,.03,.02),.8),((.1,-.04,-.03),.9),((0,0,.03),.9)):
            errors = []
            for step in (1e-4,5e-5,2.5e-5):
                divergence = math.fsum(
                    (velocity(*_shift(point,axis,step),time)[axis]
                     -velocity(*_shift(point,axis,-step),time)[axis])/(2*step)
                    for axis in range(3))
                errors.append(abs(divergence))
            self.assertLess(errors[-1], 1e-6)
            self.assertLess(errors[-1], errors[0]/12)

    def test_pressure_balance_and_asymmetric_axis(self):
        for radius,z,time in ((.07,.02,.8),(.11,-.03,.9)):
            step = 1e-5
            derivative = (_pressure((radius+step,0,z),time)
                          -_pressure((radius-step,0,z),time))/(2*step)
            swirl = velocity(radius,0,z,time)[1]
            self.assertAlmostEqual(derivative,swirl*swirl/radius,delta=2e-7)
        self.assertNotEqual(velocity(0,0,0,.8)[2],0)
        self.assertEqual(velocity(0,0,0,.8)[:2],(0.0,0.0))

    def test_analytic_profile_derivatives(self):
        # Compare jet-derived first and second derivatives with independent
        # differences of evaluated profiles away from the radial endpoints.
        y,eta,step = 1.1,.12,1e-4
        center = evaluate(y,eta)
        left,right = evaluate(y-step,eta),evaluate(y+step,eta)
        below,above = evaluate(y,eta-step),evaluate(y,eta+step)
        for name in ("F","U","v0"):
            with self.subTest(profile=name):
                expected_x = PARAMETERS.lambda_*(right[name]-left[name])/(2*step)
                expected_xx = PARAMETERS.lambda_**2*(right[name]-2*center[name]+left[name])/step**2
                expected_eta = (above[name]-below[name])/(2*step)
                expected_etaeta = (above[name]-2*center[name]+below[name])/step**2
                self.assertAlmostEqual(center[name+"_X"],expected_x,delta=2e-7*(1+abs(expected_x)))
                self.assertAlmostEqual(center[name+"_XX"],expected_xx,delta=5e-5*(1+abs(expected_xx)))
                self.assertAlmostEqual(center[name+"_eta"],expected_eta,delta=2e-6*(1+abs(expected_eta)))
                self.assertAlmostEqual(center[name+"_etaeta"],expected_etaeta,delta=2e-6*(1+abs(expected_etaeta)))

    def test_full_force_matches_independent_physical_residual(self):
        from core_profiles import external_acceleration
        for point,time in (((.05,.03,.02),.8),((.1,-.04,-.03),.9),((0,0,.03),.9)):
            expected = external_acceleration(*point,time)
            self.assertTrue(all(math.isfinite(value) for value in expected))
            errors = []
            for step in (4e-4,2e-4,1e-4):
                measured = _physical_residual(point,time,step)
                errors.append(max(abs(a-b) for a,b in zip(expected,measured)))
            scale = 1+max(abs(value) for value in expected)
            self.assertLess(errors[-1]/scale,2e-5)
            self.assertLess(errors[-1],errors[0]/10)
            # The core approximation's forcing includes omitted axial terms.
            self.assertGreater(max(abs(value) for value in expected),1e-4)


if __name__ == "__main__":
    unittest.main()
