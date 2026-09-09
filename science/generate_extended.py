#!/usr/bin/env python3
"""Export a finite-time forced continuation with a differentiable primitive.

The source core and Appendix B.22 reference continuation are retained. The
radial pressure moment and zero outer axial primitive are enforced; the other
global moments, stress cone, and full smooth-forcing construction are not.
"""
from array import array
from dataclasses import asdict
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0,str(Path(__file__).parent/"src"))
from extended_flow import (profile, velocity, force, coordinates, physical_cutoff,
                           pressure_matcher, REFERENCE_START, REFERENCE_END)
from heat_exterior import heat_factor
from profile_parameters import AxisParameters
from generate_core import PAPER_URL, PAPER_SHA256

ROOT=Path(__file__).resolve().parents[1]
CHANNELS=("J","J_Y","J_eta","J_Yeta")
Y_MAX=16.
C_INFINITY=.02


def encode(value):
    return (json.dumps(value,indent=2,allow_nan=False)+"\n").encode()


def binary(values):
    result=array("f",values)
    if sys.byteorder!="little":
        result.byteswap()
    return result.tobytes()


def make_grid(y_count,eta_count,parameters,order):
    primitive,swirl=array("f"),array("f")
    start=time.perf_counter()
    for j in range(eta_count):
        eta=2*j/(eta_count-1)-1
        for i in range(y_count):
            p=profile(Y_MAX*i/(y_count-1),eta,parameters,C_INFINITY,order)
            primitive.extend(p[k] for k in CHANNELS)
            swirl.append(p["F"])
        if j%32==0 or j==eta_count-1:
            print(f"Extended profiles: {j+1}/{eta_count} rows, {time.perf_counter()-start:.1f}s",flush=True)
    if not all(math.isfinite(v) for v in primitive) or not all(math.isfinite(v) and v>0 for v in swirl):
        raise ArithmeticError("Nonfinite primitive or nonpositive swirl in export")
    return primitive,swirl


def basis(t):
    return (2*t**3-3*t*t+1,t**3-2*t*t+t,-2*t**3+3*t*t,t**3-t*t)


def basis_derivative(t):
    return (6*t*t-6*t,3*t*t-4*t+1,-6*t*t+6*t,3*t*t-2*t)


def sample_grid(primitive,swirl,y_count,eta_count,y,eta):
    """Bicubic Hermite J and derivatives; bilinear scalar swirl F."""
    hy,he=Y_MAX/(y_count-1),2/(eta_count-1)
    a,b=min(y_count-1,max(0,y/hy)),min(eta_count-1,max(0,(eta+1)/he))
    iy,ie=min(int(a),y_count-2),min(int(b),eta_count-2)
    wy,dy,we,de=basis(a-iy),basis_derivative(a-iy),basis(b-ie),basis_derivative(b-ie)
    rows=[]
    for row in (0,1):
        lo=((ie+row)*y_count+iy)*4
        hi=lo+4
        ev=lambda weights,k: (weights[0]*primitive[lo+k]+weights[1]*hy*primitive[lo+k+1]
                              +weights[2]*primitive[hi+k]+weights[3]*hy*primitive[hi+k+1])
        rows.append((ev(wy,0),ev(dy,0)/hy,ev(wy,2),ev(dy,2)/hy))
    def ev_eta(weights,component):
        return (weights[0]*rows[0][component]+weights[1]*he*rows[0][component+2]
                +weights[2]*rows[1][component]+weights[3]*he*rows[1][component+2])
    lower=swirl[ie*y_count+iy]*(1-a+iy)+swirl[ie*y_count+iy+1]*(a-iy)
    upper=swirl[(ie+1)*y_count+iy]*(1-a+iy)+swirl[(ie+1)*y_count+iy+1]*(a-iy)
    return {"J":ev_eta(we,0),"J_Y":ev_eta(we,1),"J_eta":ev_eta(de,0)/he,
            "J_Yeta":ev_eta(de,1)/he,"F":lower*(1-b+ie)+upper*(b-ie)}


def lookup_velocity(primitive,swirl,y_count,eta_count,position,sample_time,parameters):
    x,y,z=position
    cutoff,cutoff_r,cutoff_z=physical_cutoff(x,y,z)
    if not cutoff:
        return (0.,0.,0.)
    q,radial_y,eta=coordinates(math.hypot(x,y),z,sample_time,parameters)
    if radial_y>=Y_MAX:
        r=math.hypot(x,y)
        rate=cutoff*C_INFINITY*(r*r/2)**(-.5-parameters.h)*heat_factor(4*(1-sample_time)/(r*r),parameters.h)/r
        return (-rate*y,rate*x,0.)
    p=sample_grid(primitive,swirl,y_count,eta_count,radial_y,eta)
    lam,h=parameters.lambda_,parameters.h
    d,ell=1-eta*eta,1-2*h*eta*eta
    jo=p["J"]/radial_y if radial_y else p["J_Y"]
    jeo=p["J_eta"]/radial_y if radial_y else p["J_Yeta"]
    radial=-cutoff*lam*(2*(.5-h)*eta*jo+d*jeo-2*eta*p["J_Y"])/(2*q*ell)
    radial-=cutoff_z*lam*q**(-.5-h)*jo/2
    rotation=cutoff*q**(-1-h)*p["F"]
    axial=cutoff*q**(-.5-h)*lam*p["J_Y"]+cutoff_r*q**(.5-h)*p["J"]
    return (radial*x-rotation*y,radial*y+rotation*x,axial)


def physical_point(y,eta,sample_time,angle=.37,parameters=AxisParameters()):
    q=(1-sample_time)/(1-eta*eta)
    r=math.sqrt(2*q*y/parameters.lambda_)
    return (r*math.cos(angle),r*math.sin(angle),q**(.5-parameters.h)*eta)


def validate(primitive,swirl,y_count,eta_count,parameters,order):
    coordinates_to_check=[(Y_MAX*((i*.61803398875+.13)%1),2*((i*.41421356237+.19)%1)-1) for i in range(80)]
    for y in (0.,4.1,REFERENCE_START-1e-4,REFERENCE_START+1e-4,
              (REFERENCE_START+REFERENCE_END)/2,REFERENCE_END-1e-4,REFERENCE_END+1e-4,
              4.9,5.99,6.1,6.25,7.,10.,13.75,13.9,14.01,15.9,16.):
        coordinates_to_check.extend((y,eta) for eta in (-.999,-.5,0.,.21,.999))
    channel_errors={k:0. for k in (*CHANNELS,"F")}
    normalized_error=0.
    worst=None
    for y,eta in coordinates_to_check:
        actual=sample_grid(primitive,swirl,y_count,eta_count,y,eta)
        expected=profile(y,eta,parameters,C_INFINITY,order+4)
        for k in channel_errors:
            channel_errors[k]=max(channel_errors[k],abs(actual[k]-expected[k]))
        # Velocity comparison in profile coordinates avoids cancelling large
        # physical time powers and includes pressure-bump/continuation joins.
        # q=1 for t=eta² keeps all eta queries inside the physical cutoff,
        # including near +/-1; otherwise localization would hide their errors.
        sample_time=eta*eta
        pos=physical_point(y,eta,sample_time,parameters=parameters)
        reference=velocity(*pos,sample_time,parameters,C_INFINITY,order+4)
        measured=lookup_velocity(primitive,swirl,y_count,eta_count,pos,sample_time,parameters)
        error=math.dist(reference,measured)/(1+math.hypot(*reference))
        if error>normalized_error:
            normalized_error=error
            worst={"Y":y,"eta":eta,"position":pos,"expected":reference,"actual":measured}
    if normalized_error>.005:
        raise ArithmeticError(f"Hermite/bilinear velocity error exceeds .5%: {normalized_error}; {worst}")
    # Divergence of the interpolated curl, checked in physical coordinates.
    divergence=[]
    for pos,t in (((.13,.09,.08),.5),((.5,-.15,.1),.7),((1.1,.2,.3),.3),
                  ((4.5,.1,1.),.5),((.003,.002,.001),.9999)):
        step=1e-5*min(1.,math.sqrt(1-t))
        residual,gradient_scale=0.,0.
        for axis in range(3):
            left,right=list(pos),list(pos)
            left[axis]-=step;right[axis]+=step
            lo=lookup_velocity(primitive,swirl,y_count,eta_count,left,t,parameters)
            hi=lookup_velocity(primitive,swirl,y_count,eta_count,right,t,parameters)
            term=(hi[axis]-lo[axis])/(2*step)
            residual+=term;gradient_scale+=abs(term)
        divergence.append({"position":pos,"time":t,"absoluteDivergence":abs(residual),
                           "normalizedDivergence":abs(residual)/(1+gradient_scale)})
    if max(p["normalizedDivergence"] for p in divergence)>2e-5:
        raise ArithmeticError("Interpolated curl failed divergence validation")
    moments=[pressure_matcher(parameters,C_INFINITY,order).diagnostics(eta) for eta in (-1.,-.5,0.,.5,1.)]
    return {"referenceQueryCount":len(coordinates_to_check),"maximumAbsoluteProfileErrors":channel_errors,
            "maximumNormalizedVelocityError":normalized_error,"worstVelocityQuery":worst,
            "velocityErrorNormalization":"Euclidean error/(1+reference speed), nondimensional",
            "divergenceChecks":divergence,"pressureMomentChecks":moments}


def references(parameters,order):
    samples=[]
    specs=[(0.,0.,0.),(.01,.21,.5),(3.,-.5,.9),(4.12,.1,.99),(4.13,-.2,.9999),
           (4.15,.2,.5),(4.9,.3,.9),(6.1,-.1,.99),(7.,.1,.9999),(10.,-.2,.5),
           (13.9,.5,.99),(15.9,-.5,.9),(16.1,.2,.9999),(25.,.1,.5)]
    for i,(y,eta,t) in enumerate(specs):
        p=physical_point(y,eta,t,i*.43,parameters)
        samples.append({"position":p,"time":t,"Y":y,"eta":eta,
                        "velocity":velocity(*p,t,parameters,C_INFINITY,order+4)})
    for p,t in (((.6,0.,0.),.9999),((1.,.5,0.),.9999),((0.,0.,3.),.9),
                ((4.5,.2,1.),.5),((7.9,0.,0.),.9999),((8.,0.,0.),.5),((20.,2.,-1.),.9)):
        samples.append({"position":p,"time":t,"velocity":velocity(*p,t,parameters,C_INFINITY,order+4)})
    return {"schemaVersion":1,"kind":"velocity-reference",
            "reference":"Float64 source-core/B.22 primitive, pressure-matched swirl, physical curl localization; no grid interpolation",
            "suggestedRelativeTolerance":.005,"suggestedAbsoluteTolerance":.003,"samples":samples}


def generate(output,y_count=1025,eta_count=257,order=22):
    start=time.perf_counter()
    if min(y_count,eta_count)<3 or y_count>4096 or eta_count>4096 or not 8<=order<=26:
        raise ValueError("Invalid grid dimensions or radial order")
    parameters=AxisParameters()
    primitive,swirl=make_grid(y_count,eta_count,parameters,order)
    diagnostics=validate(primitive,swirl,y_count,eta_count,parameters,order)
    refs=references(parameters,order)
    force_checks=[]
    for p,t in (((.05,.03,.02),.8),((1.2,.1,0.),.4)):
        results=[force(*p,t,parameters,C_INFINITY,order,step=step) for step in (2e-4,1e-4)]
        if not all(math.isfinite(v) for result in results for v in result):
            raise ArithmeticError("Nonfinite manufactured acceleration diagnostic")
        force_checks.append({"position":p,"time":t,"stepSizes":[2e-4,1e-4],"accelerations":results,
                             "refinementDifference":math.dist(*results),
                             "scope":"Force of this finite-time continuation, not the paper's smooth limiting forcing"})
    diagnostics["forceChecks"]=force_checks
    diagnostics["generationSeconds"]=round(time.perf_counter()-start,6)
    diagnostics["radialTaylorOrder"]=order
    diagnostics["parameters"]=asdict(parameters)
    diagnostics["interpolation"]="Bicubic Hermite primitive J; velocity from its derivatives; bilinear swirl F"
    heat=json.loads((ROOT/"web/public/datasets/heat-exterior.json").read_text())
    heat["cInfinity"]=C_INFINITY
    blobs={"extended-profile.bin":("core-profile",binary(primitive)),
           "extended-swirl.bin":("core-swirl",binary(swirl)),
           "extended-heat.json":("heat-profile",encode(heat)),
           "extended-velocity-reference.json":("velocity-reference",encode(refs)),
           "extended-validation.json":("validation",encode(diagnostics))}
    chunks=[{"url":name,"kind":kind,"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),
             "optional":kind in ("velocity-reference","validation")} for name,(kind,data) in blobs.items()]
    manifest={"schemaVersion":1,"id":"extended-forced-flow-v1","status":"extended-flow-checkpoint",
              "velocityAvailable":True,"label":"Core and surroundings · finite-time forced continuation",
              "source":{"paperUrl":PAPER_URL,"sha256":PAPER_SHA256,
                        "equations":["4.1","4.7","4.13","B.22","B.24","4.25","10.4"],
                        "formalizationConsulted":False},
              "model":{"h":parameters.h,"lambda":parameters.lambda_,"cInfinity":C_INFINITY,"viscosity":1,
                       "cutoffInner":4,"cutoffOuter":8,
                       "scope":"Source core and B.22 reference continuation, with radial pressure moment matched to a heat exterior and curl localization; remaining global moment/cone conditions and smooth limiting forcing unproved",
                       "units":"nondimensional","symmetry":"axisymmetric",
                       "remainingGlobalMomentsMatched":False,"stressConeCertified":False},
              "domain":{"radialMin":0,"radialMax":8,"axialMin":-8,"axialMax":8,
                        "coverage":"All finite positions; smoothly stationary outside physical radius 8"},
              "time":{"start":0,"end":.9999,"singular":1,"playbackAvailable":True},
              "core":{"yCount":y_count,"etaCount":eta_count,"yMax":Y_MAX,"etaMax":1,
                      "channels":list(CHANNELS),"swirlChannels":["F"]},
              "continuation":{"referenceStart":REFERENCE_START,"referenceEnd":REFERENCE_END,
                              "joinStart":4.9,"joinEnd":16,"pressureBumpStart":6,"pressureBumpEnd":14},
              "chunks":chunks,"validation":diagnostics,
              "limitations":["Finite-time forced diagnostic continuation; not the full corrected blowup construction.",
                             "The radial pressure moment is matched; the other global moments and annular stress cone are not certified.",
                             "The local leading core is preserved before its B.22 continuation; physical localization begins at radius 4.",
                             "Force diagnostics belong to this continuation and do not establish a smooth force at the singular time."]}
    manifest_data=encode(manifest)
    total=len(manifest_data)+sum(len(data) for _,data in blobs.values())
    if total>100_000_000:
        raise ArithmeticError("Extended dataset exceeds the 100 MB budget")
    output.mkdir(parents=True,exist_ok=True)
    for name,(_,data) in blobs.items():
        (output/name).write_bytes(data)
    (output/"extended-manifest.json").write_bytes(manifest_data)
    print(json.dumps({"totalDatasetBytes":total,"generationSeconds":diagnostics["generationSeconds"],
                      "maximumNormalizedVelocityError":diagnostics["maximumNormalizedVelocityError"],
                      "maximumNormalizedDivergence":max(v["normalizedDivergence"] for v in diagnostics["divergenceChecks"])},indent=2),flush=True)
    return manifest


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=ROOT/"web/public/datasets")
    parser.add_argument("--y-count",type=int,default=1025)
    parser.add_argument("--eta-count",type=int,default=257)
    parser.add_argument("--order",type=int,default=22)
    args=parser.parse_args()
    generate(args.output,args.y_count,args.eta_count,args.order)
