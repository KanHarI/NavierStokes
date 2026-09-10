"""Verify derivatives of the nonuniform Hermite candidate representation."""
from bisect import bisect_right
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from generate_candidate import eta_grid, sample, Y_MAX


class CandidateLookupTests(unittest.TestCase):
    def test_adaptive_grid_resolves_peak_and_full_parameter_interval(self):
        etas, peak, width = eta_grid(513)
        self.assertEqual((etas[0], etas[-1]), (-1., 1.))
        self.assertTrue(all(b > a for a, b in zip(etas, etas[1:])))
        index = bisect_right(etas, peak)
        self.assertLess(etas[index]-etas[index-1], width/4)
        with self.assertRaisesRegex(ValueError, 'outside'):
            sample([], etas, 9, Y_MAX+1, 0.)

    def test_nonuniform_hermite_recovers_polynomial_and_both_derivatives(self):
        etas, ny, data = [-1., -.2, -.19, 0., .001, .8, 1.], 9, []
        for eta in etas:
            for i in range(ny):
                y = Y_MAX*i/(ny-1)
                data.extend((y*(.2+eta+eta**2)+y**3*(eta**2+.1),
                    .2+eta+eta**2+3*y*y*(eta**2+.1),
                    y*(1+2*eta)+2*y**3*eta,
                    1+2*eta+6*y*y*eta, -.3*y+2*eta))
        for y in (.01, .31, 2.45, 4.1):
            for eta in (-.9, -.195, .0004, .7, .95):
                p = sample(data, etas, ny, y, eta)
                self.assertAlmostEqual(p['J'], y*(.2+eta+eta**2)+y**3*(eta**2+.1), delta=1e-11)
                self.assertAlmostEqual(p['J_Y'], .2+eta+eta**2+3*y*y*(eta**2+.1), delta=1e-11)
                self.assertAlmostEqual(p['J_eta'], y*(1+2*eta)+2*y**3*eta, delta=1e-10)
                self.assertAlmostEqual(p['log_F'], -.3*y+2*eta, delta=1e-13)
