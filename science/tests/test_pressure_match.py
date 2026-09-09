"""Check the one genuinely enforced source moment and its radial balance."""

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from pressure_match import SwirlPressureMatch, integrate
from profile_parameters import AxisParameters, pressure_datum
import extended_flow


class PressureMatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.matcher=SwirlPressureMatch(extended_flow.base_profile)

    def test_positive_normalized_smooth_annular_energy_bump(self):
        matcher=self.matcher
        norm=integrate(matcher.bump,matcher.bump_start,matcher.bump_end,96)/matcher.parameters.lambda_
        self.assertAlmostEqual(norm,1.,delta=2e-12)
        for y in (0,4.1,6,14,16,100):
            self.assertEqual(matcher.bump(y),0.)
        self.assertGreater(matcher.bump(10),0)
        self.assertEqual(matcher.bump_prefix(6),0)
        self.assertEqual(matcher.bump_prefix(14),1)

    def test_deficit_is_positive_across_the_full_axial_interval(self):
        for eta in (-1.,-.9,-.5,-.1,0.,.1,.5,.9,1.):
            diagnostic=self.matcher.diagnostics(eta)
            self.assertGreater(diagnostic["addedAnnularPressureMoment"],.5)
            self.assertLess(diagnostic["quadratureRefinementDifference"],2e-9)

    def test_pressure_moment_with_independent_refined_matched_swirl_integral(self):
        matcher=self.matcher
        for eta in (-.8,0.,.65):
            # Integrate the resulting matched swirl, rather than reporting the
            # deficit identity from its own construction as verification.
            knots=(0,1,2,3,4.1,4.1*math.exp(.005),4.1*math.exp(.01),6,8,10,12,14,16)
            total=math.fsum(integrate(lambda y:matcher.swirl(y,eta)**2,a,b,64)
                            for a,b in zip(knots,knots[1:]))/matcher.parameters.lambda_
            total+=matcher.heat_tail(16,eta,order=96)
            self.assertAlmostEqual(total,-pressure_datum(eta),delta=2e-8)

    def test_radial_pressure_derivative_matches_swirl_energy_everywhere(self):
        matcher=self.matcher
        for eta in (-.6,0.,.7):
            for y in (1.,4.12,5.8,6.5,9.,13.,15.,20.):
                step=2e-5
                derivative=matcher.parameters.lambda_*(matcher.pressure(y+step,eta)
                                                       -matcher.pressure(y-step,eta))/(2*step)
                energy=matcher.swirl(y,eta)**2
                self.assertAlmostEqual(derivative,energy,delta=2e-6*(1+energy))

    def test_preserved_core_pressure_and_unchanged_heat_exterior(self):
        from core_profiles import evaluate
        matcher=self.matcher
        for eta in (-.8,0.,.6):
            for y in (0.,1.,4.1):
                self.assertAlmostEqual(matcher.pressure(y,eta),evaluate(y,eta)["Pi"],delta=2e-9)
                self.assertEqual(matcher.swirl(y,eta),extended_flow.base_profile(y,eta)["F"])
            for y in (16.,32.):
                self.assertEqual(matcher.swirl(y,eta),extended_flow.base_profile(y,eta)["F"])
                self.assertEqual(matcher.pressure(y,eta),-matcher.heat_tail(y,eta))

    def test_annular_force_is_finite_and_numerically_stable(self):
        # The completion still requires nonzero force. Pressure matching alone
        # is not evidence that this force is smooth through the singular time.
        time,eta,y=.3,.2,10.
        q=(1-time)/(1-eta*eta)
        radius=math.sqrt(2*q*y/AxisParameters().lambda_)
        point=(radius,0.,q**(.5-AxisParameters().h)*eta)
        values=[extended_flow.force(*point,time,step=step) for step in (8e-4,4e-4,2e-4)]
        self.assertTrue(all(math.isfinite(v) for value in values for v in value))
        changes=[max(abs(a-b) for a,b in zip(left,right)) for left,right in zip(values,values[1:])]
        self.assertLess(changes[-1],changes[0]*.4)
        self.assertLess(changes[-1]/(1+max(map(abs,values[-1]))),2e-4)


if __name__=="__main__":
    unittest.main()
