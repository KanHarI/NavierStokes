import json
import math
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"science/src"))
from heat_exterior import heat_factor,linear_sample,simpson
from heat_transport import heat_angular_displacement,rotate_heat_particle


def angular_reference(radius,tau_start,tau_end,transport_delta,cutoff=1.,intervals=1024):
    average=simpson(lambda s:heat_factor(4*(tau_start+(tau_end-tau_start)*s)/radius**2),0,1,intervals)
    return transport_delta*cutoff*.02*(radius*radius/2)**(-.505)/radius*average


class HeatAngularTests(unittest.TestCase):
    def test_quadrature_against_refined_simpson_across_time_and_radius(self):
        # r=sqrt(2*tau_start) is the smallest pure-heat radius at eta=0.
        cases=((math.sqrt(2),1,1e-4,.9999),
               (2.,1,1e-4,10.),
               (math.sqrt(.02),.01,1e-4,.0099),
               (math.sqrt(.0004),.0002,.0001,.0001),
               (math.sqrt(.000202),.000101,.0001,.25),
               (5.,1,.0001,-.75))
        for radius,start,end,transport in cases:
            reference=angular_reference(radius,start,end,transport)
            finer=angular_reference(radius,start,end,transport,intervals=2048)
            result=heat_angular_displacement(radius,start,end,transport)
            self.assertLess(abs(reference-finer)/abs(finer),2e-9)
            self.assertLess(abs(result-finer)/abs(finer),1e-6)

    def test_float32_lookup_error_within_transport_tolerance(self):
        import struct
        table=json.loads((ROOT/"web/public/datasets/heat-exterior.json").read_text())
        samples=[struct.unpack("f",struct.pack("f",v))[0] for v in table["values"]]
        lookup=lambda argument,h:linear_sample(samples,argument,table["zMax"])
        for start,end in ((1,1e-4),(.01,.0001),(.0002,.0001)):
            radius=math.sqrt(2*start)
            expected=angular_reference(radius,start,end,start-end)
            actual=heat_angular_displacement(radius,start,end,start-end,factor=lookup)
            self.assertLess(abs(actual-expected)/abs(expected),1e-6)

    def test_frozen_negative_transport_and_cutoff(self):
        radius,tau,transport=.02,.0001,-.2
        expected=transport*.3*.02*(radius*radius/2)**(-.505)/radius*heat_factor(4*tau/radius**2)
        angle=heat_angular_displacement(radius,tau,tau,transport,cutoff=.3)
        self.assertEqual(angle,expected)
        point=(radius,0.,1.2)
        rotated=rotate_heat_particle(point,angle)
        self.assertAlmostEqual(math.hypot(*rotated[:2]),radius,places=15)
        self.assertEqual(rotated[2],point[2])
        self.assertEqual(heat_angular_displacement(radius,tau,tau,transport,cutoff=0),0)

    def test_invalid_time_direction_and_axis_rejected(self):
        with self.assertRaises(ValueError):
            heat_angular_displacement(0,1,.1,1)
        with self.assertRaises(ValueError):
            heat_angular_displacement(1,.1,1,1)


if __name__=="__main__":
    unittest.main()
