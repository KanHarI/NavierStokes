#!/usr/bin/env python3
"""Reproduce the small local-core profile dataset and numerical diagnostics."""
import argparse
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import time

sys.path.insert(0, str(Path(__file__).parent / "src"))
from core_profiles import coefficients, evaluate
from profile_parameters import AxisParameters, parameter_diagnostics

ROOT = Path(__file__).resolve().parents[1]
CHANNELS = ("F", "U", "v0", "Pi")
Y_MAX, ETA_MAX = 4.1, .9
PAPER_URL = "https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf"
PAPER_SHA256 = "0e779481c4da40bd28d1e642e1d8ca57447d129610df28dfa5a11e9af8ae228f"


def encode(value):
    return (json.dumps(value, indent=2, allow_nan=False)+"\n").encode()


def horner(series, y):
    total = 0.
    for coefficient in reversed(series):
        total = total*y+coefficient
    return total


def profile_row(eta, parameters, order):
    """Four scalar radial series obtained from the local analytic solution."""
    phi, u, pressure, g, _ = coefficients(eta, parameters, order)
    ell, d_exp, d = 1-2*parameters.h*eta*eta, .5-parameters.h, 1-eta*eta
    f_values = [g.c[0]*term.c[0] for term in phi]
    u_values = [term.c[0] for term in u]
    # v0=V0/X from the exact radial incompressibility integral (4.7).
    v_values = [(2*eta*term.c[0]-(2*d_exp*eta*term.c[0]+d*term.c[1])/(n+1))/ell
                for n, term in enumerate(u)]
    pi_values = [term.c[0] for term in pressure]
    return f_values, u_values, v_values, pi_values


def make_grid(y_count, eta_count, parameters, order):
    values = []
    for j in range(eta_count):
        eta = ETA_MAX*(2*j/(eta_count-1)-1)
        row = profile_row(eta, parameters, order)
        for i in range(y_count):
            y = Y_MAX*i/(y_count-1)
            values.extend(horner(series, y) for series in row)
    if not all(math.isfinite(value) for value in values):
        raise ArithmeticError("Core grid contains non-finite values")
    binary = struct.pack("<"+"f"*len(values), *values)
    return list(struct.unpack("<"+"f"*len(values), binary)), binary


def sample_grid(values, y_count, eta_count, y, eta):
    x, z = y/Y_MAX*(y_count-1), (eta/ETA_MAX+1)/2*(eta_count-1)
    i, j = min(int(x), y_count-2), min(int(z), eta_count-2)
    fx, fz = x-i, z-j
    result = []
    for channel in range(4):
        get = lambda ii, jj: values[(jj*y_count+ii)*4+channel]
        lower = get(i,j)*(1-fx)+get(i+1,j)*fx
        upper = get(i,j+1)*(1-fx)+get(i+1,j+1)*fx
        result.append(lower*(1-fz)+upper*fz)
    return result


def cartesian_velocity(position, q, field, parameters):
    x, y, _ = position
    swirl = q**(-1-parameters.h)*field["F"]
    radial = field["v0"]/(2*q)
    return [radial*x-swirl*y, radial*y+swirl*x, q**(-.5-parameters.h)*field["U"]]


def generate(output, y_count=129, eta_count=257, order=22):
    start = time.perf_counter()
    parameters = AxisParameters()
    if min(y_count, eta_count) < 3 or not 8 <= order <= 26:
        raise ValueError("At least 3 samples per axis, and 8<=order<=26 required")
    # Independent off-grid references use additional radial/eta Taylor orders.
    queries = [(Y_MAX*((i*.61803398875+.13)%1), ETA_MAX*(2*((i*.41421356237+.19)%1)-1))
               for i in range(48)]
    queries += [(y,e) for y in (0., 2.05, Y_MAX) for e in (-ETA_MAX,-.1,0.,.1,ETA_MAX)]
    reference = [evaluate(y,e,parameters,order+4) for y,e in queries]
    refinement = []
    while True:
        values, binary = make_grid(y_count, eta_count, parameters, order)
        maxima = [max(abs(v) for v in values[k::4]) for k in range(4)]
        errors = [0.]*4
        for (y,e), expected in zip(queries, reference):
            actual = sample_grid(values,y_count,eta_count,y,e)
            errors = [max(error,abs(got-expected[name]))
                      for error,got,name in zip(errors,actual,CHANNELS)]
        normalized = [error/max(scale,1e-12) for error,scale in zip(errors,maxima)]
        refinement.append({"yCount":y_count,"etaCount":eta_count,
                           "maximumAbsoluteErrorByChannel":dict(zip(CHANNELS,errors)),
                           "maximumNormalizedErrorByChannel":dict(zip(CHANNELS,normalized))})
        if max(normalized) <= .005:
            break
        if y_count >= 513 or eta_count >= 1025:
            raise ArithmeticError("Core interpolation failed the .5% channel-scale tolerance")
        y_count, eta_count = 2*y_count-1, 2*eta_count-1
    convergence = {name:0. for name in CHANNELS}
    residuals = {name:0. for name in ("angular", "axial", "pressure")}
    minimum_phi = math.inf
    for (y,e), expected in zip(queries, reference):
        low = evaluate(y,e,parameters,order)
        for name in CHANNELS:
            convergence[name] = max(convergence[name],abs(low[name]-expected[name]))
        for name in residuals:
            residuals[name] = max(residuals[name], low[name+"_relative_residual"])
        minimum_phi = min(minimum_phi,low["Phi"])
    if max(residuals.values()) > 1e-6 or max(convergence.values()) > 1e-7 or minimum_phi <= 0:
        raise ArithmeticError("Local Taylor solution failed convergence/residual/positivity checks")
    grid_refinement = []
    for stride in (4,2,1):
        if (y_count-1)%stride or (eta_count-1)%stride:
            continue
        ys, es = (y_count-1)//stride+1, (eta_count-1)//stride+1
        coarse = [values[(j*y_count+i)*4+k] for j in range(0,eta_count,stride)
                  for i in range(0,y_count,stride) for k in range(4)]
        errors = [0.]*4
        for (y,e), expected in zip(queries,reference):
            actual = sample_grid(coarse,ys,es,y,e)
            errors = [max(error,abs(got-expected[name])/max(scale,1e-12))
                      for error,got,name,scale in zip(errors,actual,CHANNELS,maxima)]
        grid_refinement.append({"yCount":ys,"etaCount":es,
                                "maximumNormalizedErrorByChannel":dict(zip(CHANNELS,errors))})

    # Points are constructed from q,eta,Y, then the Cartesian reference is
    # evaluated from the analytic field, independent of any interpolated grid.
    samples, fixed_point_error = [], 0.
    for index in range(15):
        eta = (-.85,-.1,0.,.23,.85)[index%5]
        y_profile = (0.,.013,.43,2.5,4.0)[(index*3+index//5)%5]
        sample_time = (0.,.5,.9,.99,.9999)[index//3]
        q = (1-sample_time)/(1-eta*eta)
        radius = math.sqrt(2*q*y_profile/parameters.lambda_)
        angle = index*.83
        position = [radius*math.cos(angle),radius*math.sin(angle),q**(.5-parameters.h)*eta]
        field = evaluate(y_profile,eta,parameters,order+4)
        q_iteration = max(1-sample_time,abs(position[2])**(1/(.5-parameters.h)))
        for _ in range(10):
            q_iteration = 1-sample_time+position[2]**2*q_iteration**(2*parameters.h)
        fixed_point_error = max(fixed_point_error,abs(q_iteration-q)/q)
        samples.append({"position":position,"time":sample_time,"q":q,
                        "Y":y_profile,"eta":eta,
                        "velocity":cartesian_velocity(position,q,field,parameters),
                        "profile":{name:field[name] for name in CHANNELS}})
    references = encode({"schemaVersion":1,"kind":"velocity-reference",
                         "reference":"Float64 local analytic Taylor solution at order "+str(order+4)+"; no lookup interpolation",
                         "suggestedRelativeTolerance":.005,"suggestedAbsoluteTolerance":.001,
                         "samples":samples})
    diagnostics = {
        "scope":"Local axis equations only; diagnostic pressure, no annular/exterior matching",
        "parameters":asdict(parameters), "parameterChecks":parameter_diagnostics(parameters),
        "radialTaylorOrder":order,"referenceRadialTaylorOrder":order+4,
        "referenceQueryCount":len(queries), "minimumSampledPhi":minimum_phi,
        "radialOrderMaximumAbsoluteDifference":convergence,
        "maximumRelativeEquationResiduals":residuals,
        "interpolationRefinement":refinement,
        "interpolationGridRefinement":grid_refinement,
        "channelNormalization":"Maximum absolute value of each channel on the exported grid",
        "fixedPointQTenIterationsMaximumRelativeError":fixed_point_error,
        "thresholds":{"channelNormalizedInterpolation":.005,"relativeEquationResidual":1e-6,
                      "absoluteRadialOrderDifference":1e-7},
        "generationSeconds":round(time.perf_counter()-start,6),
        "profileBytes":len(binary),
    }
    manifest = {
        "schemaVersion":1,"id":"local-core-checkpoint-v1","status":"local-core-checkpoint",
        "velocityAvailable":True,"label":"Contracting local core · unmatched diagnostic",
        "source":{"paperUrl":PAPER_URL,"sha256":PAPER_SHA256,"retrievedAt":"2026-09-09",
                  "equations":["4.1","4.5","4.7","4.13","B.1","B.3","B.15"],
                  "formalizationConsulted":False},
        "model":{"h":parameters.h,"lambda":parameters.lambda_,"cInfinity":1,"viscosity":1,
                 "scope":"Local coupled axis profile with diagnostic pressure; not an exterior-matched leading vortex",
                 "parameterStatus":"Finite diagnostic choices; B.2 continuation gate fails for default sigma",
                 "units":"nondimensional","symmetry":"axisymmetric",
                 "omitted":["matched outer pressure","annular matching","oscillatory corrections",
                            "localization","startup from rest"]},
        "coordinates":{"axis":"z","basis":"Cartesian right-handed",
                       "lookup":"q=1-t+z^2*q^(2h); eta=z/q^(.5-h); Y=lambda*r^2/(2q)",
                       "velocity":"u=(v0*x/(2q)-q^(-1-h)*F*y, v0*y/(2q)+q^(-1-h)*F*x, q^(-.5-h)*U)"},
        "domain":{"radialMin":0,"radialMax":2,"axialMin":-3,"axialMax":3,
                  "yMax":Y_MAX,"etaMax":ETA_MAX},
        "time":{"start":0,"end":.9999,"singular":1,"playbackAvailable":True},
        "core":{"yCount":y_count,"etaCount":eta_count,"yMax":Y_MAX,"etaMax":ETA_MAX,
                "channels":list(CHANNELS)},
        "chunks":[{"url":"core-profile.bin","kind":"core-profile",
                   "sha256":hashlib.sha256(binary).hexdigest(),"bytes":len(binary),
                   "encoding":"little-endian float32, RGBA, eta-major rows and Y-fast columns"},
                  {"url":"core-velocity-reference.json","kind":"velocity-reference",
                   "sha256":hashlib.sha256(references).hexdigest(),"bytes":len(references),
                   "encoding":"JSON float64","optional":True}],
        "validation":diagnostics,
        "limitations":["Only Y<=4.1 and |eta|<=.9 are represented; Cartesian bounds alone do not define coverage.",
                       "Outside the local patch is unavailable, not stationary fluid or a joined exterior.",
                       "Diagnostic axis pressure is not the Appendix A outer-matched datum.",
                       "Local similarity concentration does not establish a globally matched blowup or smooth forcing.",
                       "Pressure is per unit density; external force is not yet exported."]}
    manifest_bytes = encode(manifest)
    total = len(binary)+len(references)+len(manifest_bytes)
    if total >= 5_000_000:
        raise ArithmeticError("Local preview exceeds 5 MB budget")
    output.mkdir(parents=True,exist_ok=True)
    (output/"core-profile.bin").write_bytes(binary)
    (output/"core-velocity-reference.json").write_bytes(references)
    (output/"core-manifest.json").write_bytes(manifest_bytes)
    diagnostics["totalDatasetBytes"] = total
    report_dir = ROOT/"docs/validation"
    report_dir.mkdir(parents=True,exist_ok=True)
    (report_dir/"science-core.json").write_bytes(encode(diagnostics))
    print(json.dumps(diagnostics,indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=ROOT/"web/public/datasets")
    parser.add_argument("--y-count",type=int,default=129)
    parser.add_argument("--eta-count",type=int,default=257)
    parser.add_argument("--order",type=int,default=22)
    args = parser.parse_args()
    generate(args.output,args.y_count,args.eta_count,args.order)
