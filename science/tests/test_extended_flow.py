"""Tests for the explicit finite-time continuation and its required force."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from extended_flow import (REFERENCE_START,REFERENCE_END,force,profile,reference_profile,
                           reference_weight,smooth_step)
from core_profiles import evaluate


class ExtendedFlowTests(unittest.TestCase):
    def test_reference_follows_literal_b22_derivative_prescription(self):
        eta=.12
        for value in (0.,1.,4.1,REFERENCE_START):
            reference=reference_profile(value,eta)
            core=evaluate(value,eta)
            self.assertAlmostEqual(reference["U"],core["U"],places=14)
            self.assertAlmostEqual(reference["F"],core["F"],places=14)
        for fraction in (.2,.5,.8):
            y=REFERENCE_START+fraction*(REFERENCE_END-REFERENCE_START)
            step=5e-7
            lo,hi=reference_profile(y-step,eta),reference_profile(y+step,eta)
            core=evaluate(y,eta)
            self.assertAlmostEqual((hi["U"]-lo["U"])/(2*step),
                                   reference_weight(y)*core["U_X"]/16,delta=2e-8)
            self.assertAlmostEqual((math.log(hi["F"])-math.log(lo["F"]))/ (2*step),
                                   reference_weight(y)*core["F_X"]/(16*core["F"]),delta=2e-8)
        endpoint=reference_profile(REFERENCE_END,eta)
        beyond=reference_profile(100.,eta)
        self.assertEqual(endpoint["U"],beyond["U"])
        self.assertEqual(endpoint["F"],beyond["F"])
        self.assertAlmostEqual(beyond["J"]-endpoint["J"],
                               (100-REFERENCE_END)*endpoint["U"]/16,places=13)

    def test_primitive_derivatives_include_every_taper_and_map_term(self):
        for y,eta in ((4.4,.12),(5.8,-.3),(9.,.17),(14.2,.7)):
            p=profile(y,eta)
            step=1e-4
            yl,yr=profile(y-step,eta),profile(y+step,eta)
            el,er=profile(y,eta-step),profile(y,eta+step)
            self.assertAlmostEqual((yr["J"]-yl["J"])/(2*step),p["J_Y"],delta=2e-8)
            self.assertAlmostEqual((er["J"]-el["J"])/(2*step),p["J_eta"],delta=2e-7)
            self.assertAlmostEqual((er["J_Y"]-el["J_Y"])/(2*step),p["J_Yeta"],delta=2e-7)

    def test_full_force_vanishes_in_unlocalized_exact_heat_exterior(self):
        required=force(1.8,0.,0.,.5,step=.0004)
        self.assertLess(math.hypot(*required),2e-8)

    def test_nonzero_join_force_converges_with_physical_finite_differences(self):
        values=[force(.7,.1,.03,.5,step=step) for step in (.0008,.0004,.0002)]
        differences=[math.dist(a,b) for a,b in zip(values,values[1:])]
        self.assertGreater(math.hypot(*values[-1]),1.)
        self.assertLess(differences[1],differences[0]/3)
        self.assertLess(differences[1]/math.hypot(*values[-1]),1e-4)

    def test_step_is_flat_outside_transition(self):
        self.assertEqual(smooth_step(-1),(0.,0.))
        self.assertEqual(smooth_step(0),(0.,0.))
        self.assertEqual(smooth_step(1),(1.,0.))
        self.assertEqual(smooth_step(2),(1.,0.))
        self.assertAlmostEqual(smooth_step(.5)[0],.5)


if __name__ == "__main__":
    unittest.main()
