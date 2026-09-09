#!/usr/bin/env python3
"""Generate the exact heat-exterior checkpoint and independent diagnostics."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import time

sys.path.insert(0, str(Path(__file__).parent / "src"))
from heat_exterior import heat_factor, linear_sample, velocity

ROOT = Path(__file__).resolve().parents[1]
PAPER_URL = "https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf"
PAPER_SHA256 = "0e779481c4da40bd28d1e642e1d8ca57447d129610df28dfa5a11e9af8ae228f"


def encode(value):
    return (json.dumps(value, indent=2, allow_nan=False) + "\n").encode()


def generate(config_path, output):
    start = time.perf_counter()
    config = json.loads(config_path.read_text())
    h, count = config["h"], config["count"]
    z_max, intervals = config["zMax"], config["quadratureIntervals"]
    if count < 3 or not 0 < h < 0.01 or z_max <= 0:
        raise ValueError("Invalid preview configuration")
    domain, timing = config["domain"], config["time"]
    if (not 0 < domain["radialMin"] < domain["radialMax"] or
            not domain["axialMin"] < domain["axialMax"] or
            not timing["start"] < timing["end"] < timing["singular"] or
            4 * (1 - timing["start"]) / domain["radialMin"] ** 2 > z_max):
        raise ValueError("Domain or time exceeds lookup coverage")
    values = [heat_factor(z_max * i / (count - 1), h, intervals=intervals)
              for i in range(count)]
    values32 = [struct.unpack("f", struct.pack("f", value))[0] for value in values]
    refinement = []
    # Same 256 off-grid points for every level, with emphasis near Z=0.
    queries = [z_max * ((i + 0.37) / 256) ** 2 for i in range(256)]
    reference = [heat_factor(z, h, intervals=2 * intervals) for z in queries]
    for stride in (4, 2, 1):
        coarse = values[::stride]
        if len(coarse) < 2 or (count - 1) % stride:
            continue
        error = max(abs(linear_sample(coarse, z, z_max) - expected)
                    for z, expected in zip(queries, reference))
        refinement.append({"count": len(coarse), "maxAbsoluteInterpolationError": error})
    gpu_error = max(abs(linear_sample(values32, z, z_max) - expected)
                    for z, expected in zip(queries, reference))
    quadrature_error = max(abs(heat_factor(z, h, intervals=intervals) - expected)
                           for z, expected in zip(queries, reference))
    ode_error = 0.0
    for z in (0, 1e-3, .1, 1, 4, 8, 16):
        v, first, second = [heat_factor(z, h, derivative=m, intervals=intervals) for m in range(3)]
        residual = z*z*second + (1 + 2*(1+h)*z)*first + h*(1+h)*v
        ode_error = max(ode_error, abs(residual))
    if gpu_error > 1e-6 or ode_error > 1e-10 or quadrature_error > 1e-11:
        raise ValueError("Preview accuracy thresholds failed")
    if any(b["maxAbsoluteInterpolationError"] >= a["maxAbsoluteInterpolationError"]
           for a, b in zip(refinement, refinement[1:])):
        raise ValueError("Interpolation did not improve with refinement")
    data = {"schemaVersion": 1, "kind": "heat-profile", "zMin": 0,
            "zMax": z_max, "count": count, "h": h,
            "cInfinity": config["cInfinity"], "values": values}
    encoded = encode(data)
    # Optional fixture: evaluates the original integral at Cartesian points,
    # independently of the exported lookup and future GPU shader arithmetic.
    samples = []
    for radius, angle, axial, fraction in ((.5, 0, 0, 0), (.5, .7, -2, 1),
                                           (.8, 1.2, 1, .37), (1.7, -.8, 0, .81),
                                           (4, 2.2, 3, .5), (8, 0, -8, 1)):
        radius = max(domain["radialMin"], min(domain["radialMax"], radius))
        position = [radius * math.cos(angle), radius * math.sin(angle),
                    max(domain["axialMin"], min(domain["axialMax"], axial))]
        sample_time = timing["start"] + fraction * (timing["end"] - timing["start"])
        samples.append({"position": position, "time": sample_time,
                        "velocity": velocity(*position, sample_time, h, config["cInfinity"])})
    references = encode({"schemaVersion": 1, "kind": "velocity-reference",
                         "reference": "Float64 integral A.32; no lookup interpolation",
                         "suggestedRelativeTolerance": 2e-6, "suggestedAbsoluteTolerance": 1e-6,
                         "samples": samples})
    diagnostics = {"quadratureMaxAbsoluteDifference": quadrature_error,
                   "heatOdeMaxAbsoluteResidual": ode_error,
                   "float32LookupMaxAbsoluteError": gpu_error,
                   "interpolationRefinement": refinement,
                   "referenceQueryCount": len(queries),
                   "thresholds": {"float32LookupAbsolute": 1e-6, "heatOdeAbsolute": 1e-10},
                   "generationSeconds": round(time.perf_counter() - start, 6)}
    manifest = {
        "schemaVersion": 1, "id": "heat-exterior-checkpoint-v1",
        "status": "heat-exterior-checkpoint", "velocityAvailable": True,
        "label": "Heat exterior · core not reconstructed",
        "source": {"paperUrl": PAPER_URL, "sha256": PAPER_SHA256,
                   "retrievedAt": "2026-09-09", "equations": ["A.32", "A.33", "A.34", "A.37"],
                   "formalizationConsulted": False},
        "model": {"h": h, "cInfinity": config["cInfinity"], "viscosity": 1,
                  "scope": "Exact heat-exterior family only; core and matching not reconstructed",
                  "parameterStatus": "Diagnostic choices, not a certified assembled construction",
                  "units": "nondimensional", "symmetry": "axisymmetric, independent of axial coordinate",
                  "omitted": ["contracting core", "annular matching", "oscillatory corrections",
                              "localization", "startup from rest"],
                  "externalAcceleration": [0, 0, 0]},
        "coordinates": {"axis": "z", "basis": "Cartesian right-handed",
                        "lookup": "Z=4*(1-t)/(x*x+y*y)",
                        "velocity": "u_theta=cInfinity*(r*r/2)^(-0.5-h)*H(Z); u=(-u_theta*y/r,u_theta*x/r,0)"},
        "domain": domain, "time": timing,
        "chunks": [{"url": "heat-exterior.json", "kind": "heat-profile",
                    "sha256": hashlib.sha256(encoded).hexdigest(), "bytes": len(encoded),
                    "encoding": "JSON float64 values; GPU float32 validated", "count": count},
                   {"url": "velocity-reference.json", "kind": "velocity-reference",
                    "sha256": hashlib.sha256(references).hexdigest(), "bytes": len(references),
                    "encoding": "JSON float64", "optional": True}],
        "validation": diagnostics,
        "limitations": ["Annulus is a diagnostic crop, not the proven core/exterior boundary.",
                        "No global finite-energy or blowup claim applies to this isolated component.",
                        "Queries outside the declared domain are invalid, not stationary fluid."]}
    manifest_bytes = encode(manifest)
    if len(encoded) + len(references) + len(manifest_bytes) >= 5_000_000:
        raise ValueError("Preview exceeds 5 MB budget")
    output.mkdir(parents=True, exist_ok=True)
    (output / "heat-exterior.json").write_bytes(encoded)
    (output / "velocity-reference.json").write_bytes(references)
    (output / "manifest.json").write_bytes(manifest_bytes)
    report_dir = ROOT / "docs" / "validation"
    report_dir.mkdir(parents=True, exist_ok=True)
    diagnostics["totalDatasetBytes"] = len(encoded) + len(references) + len(manifest_bytes)
    (report_dir / "science-preview.json").write_bytes(encode(diagnostics))
    # Standalone vector diagnostic is code-derived, not an AI-generated image.
    points = " ".join(f"{60 + 680*i/(count-1):.3f},{60+12000*(1-v):.3f}" for i,v in enumerate(values))
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360">
<rect width="800" height="360" fill="#101620"/>
<g fill="#e8edf2" font-family="sans-serif"><text x="40" y="30" font-size="18">Exact heat-exterior factor H(Z), h={h}</text>
<text x="40" y="340">Z: 0 → {z_max}; H: {values[0]:.6f} → {values[-1]:.6f}; core not reconstructed</text></g>
<path d="M60 45 V300 H750" fill="none" stroke="#8393a4"/>
<polyline points="{points}" fill="none" stroke="#81d4fa" stroke-width="2"/>
</svg>'''
    (report_dir / "heat-profile.svg").write_text(svg)
    print(json.dumps(diagnostics, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "science/configs/preview.json")
    parser.add_argument("--output", type=Path, default=ROOT / "web/public/datasets")
    args = parser.parse_args()
    generate(args.config, args.output)
