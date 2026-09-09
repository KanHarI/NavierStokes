import hashlib
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "science/src"))
from heat_exterior import (axis_comparison, heat_factor, linear_sample,
                           pressure, similarity_coordinates, velocity)


class HeatExteriorTests(unittest.TestCase):
    def test_endpoint_derivatives_from_gamma_moments(self):
        h = .005
        for order in range(5):
            expected = (-1)**order * math.prod(h+i for i in range(order))
            expected *= math.prod(1+h+i for i in range(order))
            self.assertAlmostEqual(heat_factor(0, h, order), expected, delta=2e-14)

    def test_heat_equation_in_physical_coordinates(self):
        # Independent finite differences of velocity, not a residual-defined force.
        for r, t in ((.6, .2), (1.3, .4), (4, .8)):
            errors = []
            for step in (0.004, 0.002, 0.001):
                k = velocity(r, 0, 0, t)[1]
                left, right = [velocity(r+sign*step, 0, 0, t)[1] for sign in (-1, 1)]
                laplace = (right-2*k+left)/step**2 + (right-left)/(2*step*r)-k/r**2
                derivative = (velocity(r,0,0,t+step)[1]-velocity(r,0,0,t-step)[1])/(2*step)
                errors.append(abs(derivative-laplace))
            self.assertLess(errors[-1], 5e-5)
            self.assertLess(errors[-1], errors[0]/8)

    def test_cartesian_divergence_and_axis_rotation(self):
        for x, y, z in ((.6, .4, 1), (1.2, -.8, -1), (3, 2, 0)):
            step, point = 1e-4, [x,y,z]
            divergence = 0
            for axis in range(3):
                left, right = point[:], point[:]
                left[axis] -= step
                right[axis] += step
                divergence += (velocity(*right,.4)[axis]-velocity(*left,.4)[axis])/(2*step)
            self.assertLess(abs(divergence), 1e-7)
            u = velocity(x,y,z,.4)
            rotated = velocity(-y,x,z,.4)
            self.assertAlmostEqual(rotated[0], -u[1], places=14)
            self.assertAlmostEqual(rotated[1], u[0], places=14)

    def test_pressure_cancels_centripetal_acceleration(self):
        # Pressure is computed by integration; derivative tested independently.
        for r in (.7, 2.0):
            step = 1e-4
            gradient = (pressure(r+step,.3)-pressure(r-step,.3))/(2*step)
            centripetal = velocity(r,0,0,.3)[1]**2/r
            self.assertAlmostEqual(gradient, centripetal, delta=2e-6)
            self.assertLess(pressure(r,.3), 0)

    def test_axis_and_out_of_lookup_are_invalid(self):
        with self.assertRaises(ValueError):
            velocity(0,0,0,.2)
        with self.assertRaises(ValueError):
            velocity(1,0,0,1)
        with self.assertRaises(ValueError):
            linear_sample([1,.9],17)

    def test_similarity_transform_round_trip(self):
        h, d = .005, .495
        for t in (0,.9,.999999):
            for eta in (-.9,0,.6):
                q = (1-t)/(1-eta*eta)
                r, z = math.sqrt(2*q*.3), q**d*eta
                solved_q, solved_eta, solved_x = similarity_coordinates(r,z,t,h)
                self.assertAlmostEqual(solved_q/q,1,places=12)
                self.assertAlmostEqual(solved_eta,eta,places=12)
                self.assertAlmostEqual(solved_x,.3,places=12)

    def test_axis_comparison_bound(self):
        values = [axis_comparison(i*4.1/100) for i in range(101)]
        self.assertEqual(values[0],1)
        self.assertGreater(min(values),.265)
        self.assertTrue(all(a>b for a,b in zip(values,values[1:])))

    def test_export_integrity_and_coverage(self):
        output = ROOT / "web/public/datasets"
        manifest = json.loads((output/"manifest.json").read_text())
        chunk = manifest["chunks"][0]
        raw = (output/chunk["url"]).read_bytes()
        table = json.loads(raw)
        self.assertEqual(hashlib.sha256(raw).hexdigest(),chunk["sha256"])
        self.assertEqual(len(raw),chunk["bytes"])
        self.assertEqual(table["count"],len(table["values"]))
        self.assertTrue(all(math.isfinite(v) and v>0 for v in table["values"]))
        domain, timing = manifest["domain"],manifest["time"]
        self.assertLessEqual(4*(1-timing["start"])/domain["radialMin"]**2,table["zMax"])
        byte_total = (output/"manifest.json").stat().st_size
        for item in manifest["chunks"]:
            payload = (output/item["url"]).read_bytes()
            self.assertEqual(len(payload),item["bytes"])
            self.assertEqual(hashlib.sha256(payload).hexdigest(),item["sha256"])
            byte_total += len(payload)
        self.assertLess(byte_total,5_000_000)
        reference = json.loads((output/"velocity-reference.json").read_text())
        for sample in reference["samples"]:
            self.assertEqual(list(velocity(*sample["position"],sample["time"],
                                           table["h"],table["cInfinity"])),sample["velocity"])


if __name__ == "__main__":
    unittest.main()
