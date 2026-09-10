"""Independent integral checks for the five-moment annular correction."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src'))
from radial_moments import NAMES, MomentCorrection, bump, moments


class RadialMomentTests(unittest.TestCase):
    def test_source_power_law_moments_against_closed_integrals(self):
        for eta in (-.8, 0., .4):
            u, amplitude, alpha = 4*eta, 1/(1+eta*eta), .1
            integral = lambda p: (5**(p+1)-.5**(p+1))/(p+1)
            expected = dict(zip(NAMES, (u*4.5, math.sqrt(2)*amplitude*integral(alpha+.5),
                u*math.sqrt(2)*amplitude*integral(alpha+.5),
                u*u*4.5-amplitude**2*integral(2*alpha)/2,
                amplitude**2*integral(2*alpha-1)/2)))
            actual = moments(lambda x: (u, amplitude*x**alpha), [.5, 1., 2., 5.], 48)
            for name in NAMES:
                self.assertAlmostEqual(actual[name], expected[name], delta=2e-12)

    def test_all_five_moments_restored_after_a_small_compact_edit(self):
        intervals = [(1., 1.5), (2., 2.5), (3., 3.5), (5., 5.5), (8., 8.5)]
        reference = lambda x: (.3, 2*x**.1)
        edits = [1e-6, -1e-6, 2e-6, -2e-6, 1e-6]
        def edited(x):
            u, e = reference(x)
            return (u+sum(edits[i]*bump(x, intervals[i]) for i in (0, 1)),
                    e+sum(edits[i]*bump(x, intervals[i]) for i in (2, 3, 4)))
        knots = sorted({.5, 9., *[x for interval in intervals for x in interval]})
        target, before = moments(reference, knots, 64), moments(edited, knots, 64)
        correction = MomentCorrection(edited, intervals, order=48)
        report = correction.solve({name: target[name]-before[name] for name in NAMES})
        after = moments(lambda x: correction.corrected(x, report['coefficients']), knots, 64)
        for name in NAMES:
            self.assertAlmostEqual(after[name], target[name], delta=3e-12)
        for x in (.5, 1., 1.5, 2.7, 9.):
            self.assertEqual(correction.corrected(x, report['coefficients']), reference(x))
        self.assertLess(report['A2NumericalSmallness'], 1)
        self.assertFalse(report['parameterDerivativesCertified'])
        self.assertFalse(report['stressConeCertified'])

    def test_large_or_degenerate_matching_is_rejected(self):
        intervals = [(1., 1.5), (2., 2.5), (3., 3.5), (5., 5.5), (8., 8.5)]
        correction = MomentCorrection(lambda x: (.3, 2*x**.1), intervals)
        with self.assertRaisesRegex(ArithmeticError, 'small-correction bound'):
            correction.solve(dict(zip(NAMES, (1., 0., 0., 0., 0.))))
        # alpha=-1/2 collapses the two U block weights in Corollary A.3.
        with self.assertRaisesRegex(ArithmeticError, 'Jacobian'):
            MomentCorrection(lambda x: (.3, 2*x**(-.5)), intervals)

    def test_separate_inner_edit_is_matched_without_erasing_it(self):
        intervals = [(1., 1.5), (2., 2.5), (3., 3.5), (5., 5.5), (8., 8.5)]
        reference = lambda x: (.3, 2*x**.1)
        def edited(x):
            u, e = reference(x)
            return u+1e-7*bump(x, (.5, .9)), e+2e-7*bump(x, (.5, .9))
        knots = sorted({.5, .9, 9., *[x for interval in intervals for x in interval]})
        target, before = moments(reference, knots, 64), moments(edited, knots, 64)
        discrepancy = {name: target[name]-before[name] for name in NAMES}
        solutions = []
        for scales in (None, (1., 2., 3., 4., 5.)):
            correction = MomentCorrection(edited, intervals, 48, scales)
            report = correction.solve(discrepancy)
            solutions.append(report['coefficients'])
            after = moments(lambda x: correction.corrected(x, report['coefficients']), knots, 64)
            for name in NAMES:
                self.assertAlmostEqual(after[name], target[name], delta=3e-12)
            self.assertEqual(correction.corrected(.7, report['coefficients']), edited(.7))
            self.assertNotEqual(edited(.7), reference(.7))
        for left, right in zip(*solutions):
            self.assertAlmostEqual(left, right, delta=1e-15)


if __name__ == '__main__':
    unittest.main()
