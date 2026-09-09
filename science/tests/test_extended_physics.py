"""Independent physical QA of the smooth manufactured flow continuation.

These checks do not assert the source paper's global matching conditions.
"""

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
import core_profiles
import extended_flow as extended
import heat_exterior
from profile_parameters import AxisParameters

PARAMETERS=AxisParameters()


def point_from_profile(y,eta,time,angle=.41):
    q=(1-time)/(1-eta*eta)
    radius=math.sqrt(2*q*y/PARAMETERS.lambda_)
    return radius*math.cos(angle),radius*math.sin(angle),q**(.5-PARAMETERS.h)*eta


def difference_gradient(point,time,step):
    jacobian=[[0.]*3 for _ in range(3)]
    for axis in range(3):
        left,right=list(point),list(point)
        left[axis]-=step
        right[axis]+=step
        lo,hi=extended.velocity(*left,time),extended.velocity(*right,time)
        for component in range(3):
            jacobian[component][axis]=(hi[component]-lo[component])/(2*step)
    return jacobian


class ExtendedPhysicalTests(unittest.TestCase):
    def test_complete_old_core_and_pressure_are_preserved(self):
        for y,eta,time in ((0,0,.8),(.5,-.7,.2),(2.9,.6,.8),(4.1,.2,.5)):
            point=point_from_profile(y,eta,time)
            # Use the prescribed profile coordinates directly, so a Cartesian
            # round trip one ulp beyond Y=4.1 does not trip the old API's bound.
            q=(1-time)/(1-eta*eta)
            profile=core_profiles.evaluate(y,eta)
            radial,rotation=profile["v0"]/(2*q),q**(-1-PARAMETERS.h)*profile["F"]
            expected=(radial*point[0]-rotation*point[1],radial*point[1]+rotation*point[0],
                      q**(-.5-PARAMETERS.h)*profile["U"])
            measured=extended.velocity(*point,time)
            for actual,reference in zip(measured,expected):
                self.assertAlmostEqual(actual,reference,delta=2e-11*(1+abs(reference)))
            self.assertAlmostEqual(extended.pressure(*point,time),
                                   q**(-1-2*PARAMETERS.h)*profile["Pi"],delta=2e-10)

    def test_old_radial_and_axial_domain_edges_have_no_jump(self):
        for crossing in ("radial","axial"):
            jumps=[]
            for delta in (1e-5,5e-6):
                points=[point_from_profile(4.1+sign*delta,.2,.7) if crossing=="radial"
                        else point_from_profile(2,.9+sign*delta,.7)
                        for sign in (-1,1)]
                velocities=[extended.velocity(*point,.7) for point in points]
                jumps.append(max(abs(a-b) for a,b in zip(*velocities)))
            self.assertLess(jumps[-1],jumps[0]*.6)
            self.assertLess(jumps[-1],1e-3)

    def test_nonzero_source_heat_exterior_before_localization(self):
        point=point_from_profile(20,.2,.2)
        self.assertLess(math.hypot(*point),extended.LOCALIZATION_START)
        expected=heat_exterior.velocity(*point,.2,c_infinity=extended.C_INFINITY)
        actual=extended.velocity(*point,.2)
        self.assertGreater(math.hypot(*actual),1e-3)
        for a,b in zip(actual,expected):
            self.assertAlmostEqual(a,b,delta=2e-12)
        self.assertEqual(actual[2],0.)

    def test_curl_continuation_and_physical_cutoff_preserve_divergence(self):
        cases=((point_from_profile(8,.2,.2),.2),((1.,.5,5.),.2),((0.,0.,5.),.2))
        for point,time in cases:
            errors=[]
            norms=[]
            for step in (1e-3,5e-4,2.5e-4):
                jac=difference_gradient(point,time,step)
                errors.append(abs(sum(jac[k][k] for k in range(3))))
                norms.append(math.sqrt(sum(v*v for row in jac for v in row)))
            self.assertLess(errors[-1]/(1+norms[-1]),2e-6)
            self.assertLess(errors[-1],errors[0]/10)

    def test_farfield_rest_is_exact_and_finite_positions_are_covered(self):
        for point in ((8.,0.,0.),(0.,0.,-8.),(10.,10.,10.),(1e308,1e308,1e308)):
            self.assertEqual(extended.velocity(*point,.9999),(0.,0.,0.))
            self.assertEqual(extended.pressure(*point,.9999),0.)
            self.assertEqual(extended.force(*point,.9999),(0.,0.,0.))
        for point in ((0.,0.,0.),(.01,.01,7.5),(3.,2.,4.),(2.,0.,0.)):
            self.assertTrue(all(math.isfinite(value) for value in extended.velocity(*point,.9999)))
            self.assertTrue(math.isfinite(extended.pressure(*point,.9999)))

    def test_full_force_recovers_independent_analytic_core_and_converges_outside(self):
        point=point_from_profile(2,.2,.4)
        expected=core_profiles.external_acceleration(*point,.4)
        errors=[]
        for step in (4e-4,2e-4,1e-4):
            actual=extended.force(*point,.4,step=step)
            errors.append(max(abs(a-b) for a,b in zip(actual,expected)))
        self.assertLess(errors[-1]/(1+max(map(abs,expected))),2e-5)
        self.assertLess(errors[-1],errors[0]/10)
        # Outside the preserved core no closed-force source theorem is assumed.
        # Assess the diagnostic residual's numerical stability under refinement.
        for point in (point_from_profile(8,.2,.2),(1.,.5,5.)):
            forces=[extended.force(*point,.2,step=step) for step in (8e-4,4e-4,2e-4)]
            self.assertTrue(all(math.isfinite(v) for force in forces for v in force))
            changes=[max(abs(a-b) for a,b in zip(left,right)) for left,right in zip(forces,forces[1:])]
            self.assertLess(changes[-1],changes[0]*.4)
            self.assertLess(changes[-1]/(1+max(map(abs,forces[-1]))),2e-4)


if __name__ == "__main__":
    unittest.main()
