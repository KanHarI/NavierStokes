"""Checks of the shipped float32 artifact against analytic reference points."""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"science"))
from generate_core import sample_grid


class CoreDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = ROOT/"web/public/datasets"
        cls.manifest = json.loads((cls.directory/"core-manifest.json").read_text())
        binary = (cls.directory/"core-profile.bin").read_bytes()
        cls.values = struct.unpack("<"+"f"*(len(binary)//4),binary)
        cls.references = json.loads((cls.directory/"core-velocity-reference.json").read_text())

    def test_dataset_integrity_and_declared_scope(self):
        manifest = self.manifest
        self.assertEqual(manifest["status"],"local-core-checkpoint")
        self.assertFalse(manifest["validation"]["parameterChecks"]["global_matching_certified"])
        total = 0
        for chunk in manifest["chunks"]:
            binary = (self.directory/chunk["url"]).read_bytes()
            self.assertEqual(len(binary),chunk["bytes"])
            self.assertEqual(hashlib.sha256(binary).hexdigest(),chunk["sha256"])
            total += len(binary)
        self.assertLess(total,5_000_000)
        self.assertTrue(all(math.isfinite(value) for value in self.values))

    def test_compressed_field_reconstructs_analytic_physical_velocity(self):
        core, h = self.manifest["core"], self.manifest["model"]["h"]
        lam = self.manifest["model"]["lambda"]
        for sample in self.references["samples"]:
            x,y,z = sample["position"]
            tau = 1-sample["time"]
            q = max(tau,abs(z)**(1/(.5-h)))
            for _ in range(10):
                q = tau+z*z*q**(2*h)
            radial_y, eta = lam*(x*x+y*y)/(2*q), z/q**(.5-h)
            f,u,v0,_ = sample_grid(self.values,core["yCount"],core["etaCount"],radial_y,eta)
            swirl,radial = q**(-1-h)*f,v0/(2*q)
            actual = (radial*x-swirl*y,radial*y+swirl*x,q**(-.5-h)*u)
            expected = sample["velocity"]
            absolute = math.sqrt(sum((a-b)**2 for a,b in zip(actual,expected)))
            magnitude = math.sqrt(sum(value*value for value in expected))
            self.assertLess(absolute,.001+.005*magnitude)

    def test_grid_refinement_reduces_interpolation_error(self):
        levels = self.manifest["validation"]["interpolationGridRefinement"]
        self.assertGreaterEqual(len(levels),3)
        for coarse,fine in zip(levels,levels[1:]):
            for channel in self.manifest["core"]["channels"]:
                self.assertLess(fine["maximumNormalizedErrorByChannel"][channel],
                                coarse["maximumNormalizedErrorByChannel"][channel])


if __name__ == "__main__":
    unittest.main()
