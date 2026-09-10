#!/usr/bin/env python3
"""Generate an adaptive LOCAL core candidate for offline comparison.

This artifact is deliberately not a browser field: no surrounding flow has
been matched to it. Log swirl and nonuniform double-precision eta coordinates
retain features that the current uniform float32 texture cannot represent.
"""
from array import array
from bisect import bisect_right
from dataclasses import asdict
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent/'src'))
from core_profiles import coefficients, evaluate
from profile_parameters import AxisParameters, axis_peak_eta, axis_log_amplitude
from outer_schedule import OuterScheduleParameters
from extended_flow import _evaluate
from generate_extended import basis, basis_derivative
from generate_core import PAPER_URL, PAPER_SHA256

ROOT = Path(__file__).resolve().parents[1]
PARAMETERS = AxisParameters(sigma=.0005, lambda_=1e7, axis_amplitude=.001,
    outer_schedule=OuterScheduleParameters(p_star=1.0985325849843381))
CHANNELS = ('J', 'J_Y', 'J_eta', 'J_Yeta', 'log_F')
Y_MAX = 4.1


def eta_grid(count, parameters=PARAMETERS):
    if count < 17:
        raise ValueError('At least 17 adaptive eta rows are required')
    peak = axis_peak_eta(parameters)
    hp = 4.5-parameters.h-12*peak*peak-2*parameters.j0*peak
    width = parameters.sigma/math.sqrt(parameters.lambda_*(1-2*parameters.h*peak*peak)*hp)
    lo, hi = math.asinh((-1-peak)/width), math.asinh((1-peak)/width)
    values = [peak+width*math.sinh(lo+(hi-lo)*i/(count-1)) for i in range(count)]
    values[0], values[-1] = -1., 1.
    return values, peak, width


def sample(table, etas, y_count, y, eta):
    if not math.isfinite(y) or not math.isfinite(eta) or not 0 <= y <= Y_MAX or not etas[0] <= eta <= etas[-1]:
        raise ValueError('Candidate query is outside its local profile domain')
    iy = min(y_count-2, max(0, int(y/Y_MAX*(y_count-1))))
    ie = min(len(etas)-2, max(0, bisect_right(etas, eta)-1))
    hy, he = Y_MAX/(y_count-1), etas[ie+1]-etas[ie]
    ty, te = y/hy-iy, (eta-etas[ie])/he
    wy, dy, we, de = basis(ty), basis_derivative(ty), basis(te), basis_derivative(te)
    rows = []
    for row in (0, 1):
        low = ((ie+row)*y_count+iy)*5
        high = low+5
        def ev(w, k):
            return w[0]*table[low+k]+w[1]*hy*table[low+k+1]+w[2]*table[high+k]+w[3]*hy*table[high+k+1]
        rows.append((ev(wy, 0), ev(dy, 0)/hy, ev(wy, 2), ev(dy, 2)/hy,
                     (1-ty)*table[low+4]+ty*table[high+4]))
    def axial(w, k):
        return w[0]*rows[0][k]+w[1]*he*rows[0][k+2]+w[2]*rows[1][k]+w[3]*he*rows[1][k+2]
    return {'J': axial(we, 0), 'J_Y': axial(we, 1), 'J_eta': axial(de, 0)/he,
            'log_F': (1-te)*rows[0][4]+te*rows[1][4]}


def axis_log_error(table, etas, y_count):
    """Expose tail errors that a peak-normalized velocity metric can hide."""
    return max(abs(sample(table, etas, y_count, 0., (left+right)/2)['log_F']
                   -axis_log_amplitude((left+right)/2, PARAMETERS))
               for left, right in zip(etas, etas[1:]))


def generate(output, y_count=65, eta_count=513):
    if y_count < 3:
        raise ValueError('At least three radial samples are required')
    started = time.perf_counter()
    etas, peak, width = eta_grid(eta_count)
    data = array('d')
    for j, eta in enumerate(etas):
        phi, u, _, _, _ = coefficients(eta, PARAMETERS, 24)
        log_g = axis_log_amplitude(eta, PARAMETERS)
        for i in range(y_count):
            y = Y_MAX*i/(y_count-1)
            angular = _evaluate(phi, y)
            if angular <= 0:
                raise ArithmeticError('Candidate lost positive Phi')
            data.extend((_evaluate(u, y, integral=True)/PARAMETERS.lambda_,
                         _evaluate(u, y)/PARAMETERS.lambda_,
                         _evaluate(u, y, component=1, integral=True)/PARAMETERS.lambda_,
                         _evaluate(u, y, component=1)/PARAMETERS.lambda_,
                         log_g+math.log(angular)))
        if j % 128 == 0:
            print(f'Adaptive candidate: {j+1}/{eta_count} rows', file=sys.stderr, flush=True)
    # Compare independent radial order32 at off-grid points, including the
    # previously unresolved peak. Normalize swirl by its axis peak amplitude.
    checks = [(Y_MAX*((i*.61803398875+.13)%1),
               etas[j]+.43*(etas[j+1]-etas[j])) for i, j in enumerate(range(0, eta_count-1, 4))]
    checks += [(y, peak+offset*width) for y in (0., 1., 2., Y_MAX) for offset in (-3., -1., 0., 1., 3.)]
    maximum_swirl, maximum_meridional = 0., 0.
    for y, eta in checks:
        actual, reference = sample(data, etas, y_count, y, eta), evaluate(y, eta, PARAMETERS, 32)
        swirl = math.exp(actual['log_F'])
        maximum_swirl = max(maximum_swirl, abs(swirl-reference['F'])/PARAMETERS.axis_amplitude)
        u = PARAMETERS.lambda_*actual['J_Y']
        if y > 0:
            v0 = PARAMETERS.lambda_*(2*eta*actual['J_Y']
                -(2*(.5-PARAMETERS.h)*eta*actual['J']+(1-eta*eta)*actual['J_eta'])/y)/(1-2*PARAMETERS.h*eta*eta)
            error = max(abs(u-reference['U'])/(1+abs(reference['U'])),
                        abs(v0-reference['v0'])/(1+abs(reference['v0'])))
        else:
            error = abs(u-reference['U'])/(1+abs(reference['U']))
        maximum_meridional = max(maximum_meridional, error)
    if maximum_swirl > .005 or maximum_meridional > .005:
        raise ArithmeticError(f'Adaptive interpolation exceeds .5%: swirl={maximum_swirl}, meridional={maximum_meridional}')
    if not all(math.isfinite(v) for v in data):
        raise ArithmeticError('Candidate table has nonfinite entries')
    log_error = axis_log_error(data, etas, y_count)
    if sys.byteorder != 'little':
        data.byteswap()
    blob = data.tobytes()
    metadata = {'schemaVersion': 1, 'status': 'offline-local-candidate', 'browserReady': False,
        'source': {'paperUrl': PAPER_URL, 'sha256': PAPER_SHA256,
                   'equations': ['4.7', '4.13', 'A.21', 'B.15', 'B.17', 'B.19']},
        'parameters': asdict(PARAMETERS), 'channels': CHANNELS, 'format': 'float64-le',
        'yCount': y_count, 'yMax': Y_MAX, 'etaCoordinates': etas,
        'axisPeakEta': peak, 'axisPeakWidth': width,
        'table': {'file': 'local-core.bin', 'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest()},
        'validation': {'offGridQueries': len(checks), 'generationOrder': 24, 'referenceOrder': 32,
            'maximumSwirlErrorOverAxisAmplitude': maximum_swirl,
            'maximumNormalizedMeridionalError': maximum_meridional,
            'maximumAxisMidpointLogSwirlError': log_error,
            'generationSeconds': round(time.perf_counter()-started, 3)},
        'limitations': ['Only the local leading equations on Y<=4.1; no exterior attached.',
            'Normalized finite outer pressure; full A.6 hierarchy, complex analytic bounds and stress cone not certified.',
            'Nonuniform eta and logarithmic swirl require a new validated browser sampler before display.',
            'Peak-normalized velocity accuracy does not establish relative swirl or derivative accuracy in negligible tails.',
            'Sampled interpolation checks are not uniform or interval-arithmetic error bounds.']}
    if len(blob) > 100_000_000:
        raise ArithmeticError('Candidate exceeds 100 MB')
    output.mkdir(parents=True, exist_ok=True)
    (output/'local-core.bin').write_bytes(blob)
    (output/'manifest.json').write_text(json.dumps(metadata, indent=2, allow_nan=False)+'\n')
    print(json.dumps(metadata['validation'], indent=2))
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'science/candidates/local-core')
    parser.add_argument('--y-count', type=int, default=65)
    parser.add_argument('--eta-count', type=int, default=513)
    args = parser.parse_args()
    generate(args.output, args.y_count, args.eta_count)
