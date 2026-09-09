"""Numerical convergence and physical checks for the local leading core."""

import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from core_profiles import evaluate, velocity
from profile_parameters import AxisParameters, axis_amplitude_at


class CoreProfileTests(unittest.TestCase):
    def test_axis_data_and_cartesian_regular_inflow(self):
        for eta in (-.8,0,.2,.8):
            p=evaluate(0,eta)
            self.assertAlmostEqual(p["U"],4*eta+.025,places=14)
            self.assertAlmostEqual(p["F"],axis_amplitude_at(eta),places=14)
            self.assertAlmostEqual(p["Pi"],-4/(1+eta*eta)**2,places=14)
        self.assertAlmostEqual(evaluate(0,0)["v0"],-4)
        self.assertEqual(velocity(0,0,0,.5)[:2],(0,0))
        for radius in (1e-3,1e-5,1e-7):
            v=velocity(radius,0,0,.5)
            self.assertLess(v[0],0)
            self.assertTrue(all(math.isfinite(component) for component in v))

    def test_radial_truncation_converges_across_local_patch(self):
        maxima=[]
        for order in (10,14,18,22):
            error=0
            for eta in (-1,-.6,-.2,0,.1,.4,.7,1):
                for y in (0,1,2,4.1):
                    p=evaluate(y,eta,order=order)
                    self.assertGreater(p["Phi"],.15)
                    error=max(error,p["angular_relative_residual"],
                              p["axial_relative_residual"],p["pressure_relative_residual"])
            maxima.append(error)
        for coarse,fine in zip(maxima,maxima[1:]):
            self.assertLess(fine,coarse/100)
        self.assertLess(maxima[-1],1e-10)

    def test_independent_physical_leading_momentum_brackets(self):
        h=.005
        a,d=.5+h,.5-h
        for y,eta in ((.2,-.6),(1,0),(2,.2),(4.1,.7)):
            p=evaluate(y,eta)
            x=y/16
            ell=1-2*h*eta*eta
            def temporal(b,f,fx,fe):
                return (-b*f+d*eta*fe+x*fx)/ell
            def axial(b,f,fx,fe):
                return (2*b*eta*f+(1-eta*eta)*fe-2*eta*x*fx)/ell
            f,u,g=p["F"],p["U"],p["v0"]/2
            angular=(temporal(-1-h,f,p["F_X"],p["F_eta"])
                     +2*g*(f+x*p["F_X"])
                     +u*axial(-1-h,f,p["F_X"],p["F_eta"])
                     -4*p["F_X"]-2*x*p["F_XX"])
            axial_res=(temporal(-a,u,p["U_X"],p["U_eta"])
                       +2*x*g*p["U_X"]+u*axial(-a,u,p["U_X"],p["U_eta"])
                       +axial(-2*a,p["Pi"],p["Pi_X"],p["Pi_eta"])
                       -2*p["U_X"]-2*x*p["U_XX"])
            self.assertLess(abs(angular),1e-10)
            self.assertLess(abs(axial_res),1e-10)

    def test_cartesian_incompressibility_by_finite_differences(self):
        errors=[]
        for step in (2e-4,1e-4,5e-5):
            maximum=0
            for point in ((.1,.12,.08),(.03,-.08,-.2),(.2,0,.3)):
                divergence=0
                for axis in range(3):
                    left,right=list(point),list(point)
                    left[axis]-=step
                    right[axis]+=step
                    divergence+=(velocity(*right,.4)[axis]-velocity(*left,.4)[axis])/(2*step)
                maximum=max(maximum,abs(divergence))
            errors.append(maximum)
        self.assertLess(errors[-1],2e-6)
        self.assertLess(errors[-1],errors[0]/10)

    def test_profile_derivatives_agree_with_finite_difference(self):
        y,eta=1.7,.12
        p=evaluate(y,eta)
        dy,de=1e-4,1e-5
        left,right=evaluate(y-dy,eta),evaluate(y+dy,eta)
        below,above=evaluate(y,eta-de),evaluate(y,eta+de)
        for field in ("F","U","v0","Pi"):
            self.assertAlmostEqual((right[field]-left[field])*16/(2*dy),
                                   p[field+"_X"],delta=2e-7)
            self.assertAlmostEqual((above[field]-below[field])/(2*de),
                                   p[field+"_eta"],delta=2e-7)

    def test_similarity_contraction_and_velocity_growth(self):
        eta,y=.2,1.5
        axial_speeds=[]
        radii=[]
        for q in (.5,.05,.005):
            radius=math.sqrt(2*q*y/16)
            z=q**.495*eta
            time=1-q*(1-eta*eta)
            v=velocity(radius,0,z,time)
            self.assertLess(v[0],0)
            axial_speeds.append(v[2])
            radii.append(radius)
        self.assertAlmostEqual(radii[0]/radii[1],math.sqrt(10),places=12)
        self.assertAlmostEqual(axial_speeds[1]/axial_speeds[0],10**.505,places=10)
        self.assertAlmostEqual(axial_speeds[2]/axial_speeds[1],10**.505,places=10)

    def test_local_domain_is_not_silently_extended(self):
        with self.assertRaises(ValueError):
            velocity(2,0,0,.5)
        with self.assertRaises(ValueError):
            evaluate(1,1.01)
        with self.assertRaises(ValueError):
            velocity(0,0,0,1)

    def test_finite_parameter_continuation(self):
        # Same source axis-family, finite diagnostic lambda; no theorem schedule.
        for lam in (12,16,24):
            params=AxisParameters(lambda_=lam)
            for y,eta in ((2,0),(4.1,.4)):
                p=evaluate(y,eta,params)
                self.assertGreater(p["Phi"],0)
                self.assertLess(p["angular_relative_residual"],2e-8)
                self.assertLess(p["axial_relative_residual"],2e-8)


if __name__ == "__main__":
    unittest.main()
