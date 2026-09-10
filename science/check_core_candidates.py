#!/usr/bin/env python3
"""Print a small reproducible candidate sweep; never modifies datasets."""

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
from core_feasibility import check_candidate
from profile_parameters import AxisParameters


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outer-schedule", action="store_true",
                        help="Use the finite Appendix A schedule pressure instead of the diagnostic rational datum")
    parser.add_argument("--outer-p-star", type=float, default=1.0985325849843381,
                        help="Finite outer amplitude; default normalizes the schedule to Pi0(0)=-4")
    parser.add_argument("--sigma", type=float, default=.0005)
    parser.add_argument("--h", type=float, default=.005)
    parser.add_argument("--outer-lambda", type=float, default=.08)
    parser.add_argument("--lambdas", type=float, nargs="+", default=[16., 100., 1000.])
    parser.add_argument("--amplitude", type=float, default=1e-8)
    parser.add_argument("--uniform-count", type=int, default=25)
    parser.add_argument("--orders", type=int, nargs="+", default=[18, 24, 32])
    parser.add_argument("--include-default", action="store_true",
                        help="Prepend the currently displayed diagnostic core as a baseline")
    parser.add_argument("--output", type=Path,
                        help="Write the JSON report to this path instead of standard output")
    args = parser.parse_args()
    extra = {}
    if args.outer_schedule:
        from outer_schedule import OuterScheduleParameters
        extra["outer_schedule"] = OuterScheduleParameters(
            p_star=args.outer_p_star, h=args.h, lambda_=args.outer_lambda)
    candidates = ([AxisParameters()] if args.include_default else []) + [
        AxisParameters(h=args.h, sigma=args.sigma, lambda_=lam,
                       axis_amplitude=args.amplitude, **extra) for lam in args.lambdas]
    results = []
    for parameters in candidates:
        started = time.monotonic()
        report = check_candidate(parameters, tuple(args.orders), args.uniform_count)
        report["parameters"] = asdict(parameters)
        report["elapsed_seconds"] = round(time.monotonic()-started, 3)
        results.append(report)
        print(f"Lambda={parameters.lambda_:g}: sampled core={report['sampled_core_resolved']}; "
              f"continuation={report['sampled_continuation_checks_pass']}", file=sys.stderr, flush=True)
    encoded = json.dumps({"candidates": results}, indent=2, allow_nan=False)+"\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
