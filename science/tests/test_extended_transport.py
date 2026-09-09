"""Independent midpoint transport convergence on the exported browser field.

The dataset exporter separately compares this sampled field with the analytic
reference. Here the same field is held fixed while time steps are refined.
"""
from array import array
import json
import math
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"science"))
from generate_extended import lookup_velocity,physical_point
from profile_parameters import AxisParameters


def load_transport_field():
    directory=ROOT/"web/public/datasets"
    manifest=json.loads((directory/"extended-manifest.json").read_text())
    primitive,swirl=array("f"),array("f")
    primitive.frombytes((directory/"extended-profile.bin").read_bytes())
    swirl.frombytes((directory/"extended-swirl.bin").read_bytes())
    if sys.byteorder!="little":
        primitive.byteswap();swirl.byteswap()
    parameters=AxisParameters()
    return lambda point,time:lookup_velocity(primitive,swirl,manifest["core"]["yCount"],
                                             manifest["core"]["etaCount"],point,time,parameters)


def midpoint_trajectory(sample,initial,start,end,fraction):
    position=list(initial)
    time=start
    traveled=0.
    steps=0
    while time<end:
        dt=min(fraction*(1-time),end-time)
        initial_velocity=sample(position,time)
        midpoint=[p+dt*v/2 for p,v in zip(position,initial_velocity)]
        midpoint_velocity=sample(midpoint,time+dt/2)
        position=[p+dt*v for p,v in zip(position,midpoint_velocity)]
        traveled+=dt*math.hypot(*midpoint_velocity)
        time+=dt
        steps+=1
        if steps>50_000:
            raise ArithmeticError("Transport step budget unexpectedly exceeded")
    return {"position":position,"traveledLength":traveled,"steps":steps}


def transport_report():
    sample=load_transport_field()
    fractions=(.0025,.00125,.000625)
    cases=[]
    for start,end,label in ((0.,.9,"early"),(.9998,.9999,"late")):
        for y in (8.,10.,12.):
            for eta in (0.,.5):
                initial=physical_point(y,eta,start)
                levels=[midpoint_trajectory(sample,initial,start,end,fraction) for fraction in fractions]
                errors=[math.dist(level["position"],levels[-1]["position"]) for level in levels[:-1]]
                fine_change=math.dist(levels[1]["position"],levels[2]["position"])
                coarse_change=math.dist(levels[0]["position"],levels[1]["position"])
                cases.append({"interval":label,"start":start,"end":end,"Y":y,"eta":eta,
                              "initialPosition":initial,"levels":levels,
                              "coarseErrorVsQuarter":errors[0],
                              "halfErrorVsQuarter":errors[1],
                              "coarseErrorOverTravel":errors[0]/max(levels[-1]["traveledLength"],1e-30),
                              "coarseErrorOverInitialRadius":errors[0]/max(math.hypot(*initial),1e-30),
                              "coarseErrorOverFinalRadius":errors[0]/max(math.hypot(*levels[-1]["position"]),1e-30),
                              "halfErrorOverFinalRadius":errors[1]/max(math.hypot(*levels[-1]["position"]),1e-30),
                              "successiveDifferenceRatio":fine_change/max(coarse_change,1e-30)})
    return {"field":"Exported Hermite streamfunction and bilinear swirl, fixed during refinement",
            "method":"Explicit midpoint RK2, dt=fraction*(1-t), velocity multiplier 1",
            "fractions":fractions,"cases":cases}


class ExtendedTransportTests(unittest.TestCase):
    def test_midpoint_time_refinement_on_the_fixed_exported_field(self):
        report=transport_report()
        for case in report["cases"]:
            with self.subTest(interval=case["interval"],Y=case["Y"],eta=case["eta"]):
                self.assertLess(case["successiveDifferenceRatio"],.5)
                self.assertLess(case["coarseErrorOverFinalRadius"],.005)
                self.assertLess(case["halfErrorOverFinalRadius"],.005)


if __name__=="__main__":
    if "--report" in sys.argv:
        print(json.dumps(transport_report(),indent=2))
    else:
        unittest.main()
