"""Five radial moments (4.15) and small annular corrections (A.2/A.3).

All estimates here are finite floating-point diagnostics. Matching values at
one eta does not certify parameter derivatives, the stress cone, or a global
Navier--Stokes construction.
"""
import math
from pressure_match import gauss_legendre

NAMES = ('M', 'I', 'J', 'S', 'Cp')


def densities(x, u, e):
    if not x > 0 or not all(math.isfinite(v) for v in (x, u, e)):
        raise ValueError('Finite profiles and X>0 are required')
    angular_momentum = math.sqrt(2*x)*e
    return (u, angular_momentum, u*angular_momentum, u*u-e*e/2, e*e/(2*x))


def quadrature(knots, order=32):
    if len(knots) < 2 or knots[0] < 0 or any(b <= a for a, b in zip(knots, knots[1:])):
        raise ValueError('Ordered nonnegative radial knots are required')
    return tuple(((a+b)/2+(b-a)*node/2, weight*(b-a)/2)
                 for a, b in zip(knots, knots[1:]) for node, weight in gauss_legendre(order))


def moments(profile, knots, order=32):
    """Integrate U,E over declared knots; callers must resolve every transition."""
    values = [[] for _ in NAMES]
    for x, weight in quadrature(knots, order):
        u, e = profile(x)
        for row, value in zip(values, densities(x, u, e)):
            row.append(weight*value)
    return dict(zip(NAMES, map(math.fsum, values)))


def _solve(matrix, rhs):
    """Partial-pivot elimination for this five-dimensional moment system."""
    a = [list(row)+[value] for row, value in zip(matrix, rhs)]
    n = len(rhs)
    for column in range(n):
        pivot = max(range(column, n), key=lambda row: abs(a[row][column]))
        if abs(a[pivot][column]) < 1e-14:
            raise ArithmeticError('Moment Jacobian is singular or poorly resolved')
        a[column], a[pivot] = a[pivot], a[column]
        scale = a[column][column]
        a[column] = [value/scale for value in a[column]]
        for row in range(n):
            if row != column:
                scale = a[row][column]
                a[row] = [v-scale*w for v, w in zip(a[row], a[column])]
    return [row[-1] for row in a]


def bump(x, interval):
    lo, hi = interval
    s = (x-lo)/(hi-lo)
    # Unit peak and flat endpoints; disjoint supports eliminate cross terms.
    return math.exp(4-1/(s*(1-s))) if 0 < s < 1 else 0.


class MomentCorrection:
    """Two U bumps and three E bumps with the exact quadratic moment map.

    Supports are disjoint and lie away from the axis. Solve only discrepancies
    satisfying the numerical contraction bound of A.2; never force a large,
    unsupported correction into the visualization.
    """
    def __init__(self, profile, intervals, order=32, row_scales=None):
        if len(intervals) != 5 or intervals[0][0] <= 0:
            raise ValueError('Five disjoint positive-radius bump intervals are required')
        if any(b <= a for a, b in intervals) or any(intervals[i][1] >= intervals[i+1][0] for i in range(4)):
            raise ValueError('Bump intervals must be ordered and disjoint')
        self.profile, self.intervals, self.order = profile, tuple(intervals), order
        self.scales = tuple(row_scales or (1.,)*5)
        if len(self.scales) != 5 or any(not math.isfinite(v) or v <= 0 for v in self.scales):
            raise ValueError('Five finite positive row scales are required')
        self.linear = [[0.]*5 for _ in NAMES]
        self.quadratic = [[0.]*5 for _ in NAMES]
        for j, interval in enumerate(intervals):
            linear, quadratic = [[] for _ in NAMES], [[] for _ in NAMES]
            for x, weight in quadrature(interval, order):
                u, e = profile(x)
                if not all(math.isfinite(v) for v in (u, e)) or e <= 0:
                    raise ValueError('The base correction profile must have finite U and positive E')
                b, root = bump(x, interval), math.sqrt(2*x)
                first = (b, 0., root*e*b, 2*u*b, 0.) if j < 2 else (0., root*b, root*u*b, -e*b, e*b/x)
                second = (0., 0., 0., b*b, 0.) if j < 2 else (0., 0., 0., -b*b/2, b*b/(2*x))
                for i in range(5):
                    linear[i].append(weight*first[i]/self.scales[i])
                    quadratic[i].append(weight*second[i]/self.scales[i])
            for i in range(5):
                self.linear[i][j] = math.fsum(linear[i])
                self.quadratic[i][j] = math.fsum(quadratic[i])
        columns = [_solve(self.linear, [float(i == j) for i in range(5)]) for j in range(5)]
        self.inverse_norm = max(math.fsum(abs(columns[j][i]) for j in range(5)) for i in range(5))
        self.quadratic_norm = max(math.fsum(abs(v) for v in row) for row in self.quadratic)

    def change(self, coefficients):
        return [math.fsum(b*c+q*c*c for b, q, c in zip(br, qr, coefficients))
                for br, qr in zip(self.linear, self.quadratic)]

    def corrected(self, x, coefficients):
        u, e = self.profile(x)
        for j, (coefficient, interval) in enumerate(zip(coefficients, self.intervals)):
            delta = coefficient*bump(x, interval)
            if j < 2:
                u += delta
            else:
                e += delta
        return u, e

    def solve(self, discrepancy, tolerance=1e-12):
        desired = [discrepancy[name]/scale for name, scale in zip(NAMES, self.scales)]
        if not all(math.isfinite(v) for v in desired):
            raise ValueError('Moment discrepancies must be finite')
        norm = max(map(abs, desired))
        smallness = 8*self.inverse_norm**2*self.quadratic_norm*norm
        if smallness > 1:
            raise ArithmeticError(f'Moment discrepancy exceeds the A.2 small-correction bound: {smallness:.6g}>1')
        coefficients = [0.]*5
        for iteration in range(128):
            quadratic = [math.fsum(q*c*c for q, c in zip(row, coefficients)) for row in self.quadratic]
            coefficients = _solve(self.linear, [d-q for d, q in zip(desired, quadratic)])
            error = max(abs(a-b) for a, b in zip(self.change(coefficients), desired))
            if error <= tolerance*max(norm, 1e-12):
                break
        else:
            raise ArithmeticError('Small moment correction failed to converge')
        if max(map(abs, coefficients)) > 2*self.inverse_norm*norm+1e-14:
            raise ArithmeticError('Correction left the A.2 small-solution ball')
        minimum_e = min(self.corrected(x, coefficients)[1]
                        for interval in self.intervals for x, _ in quadrature(interval, 2*self.order))
        if minimum_e <= 0:
            raise ArithmeticError('Correction lost positive swirl at a validation point')
        # Independent refined integration of actual fields checks the polynomial
        # map, including its quadratic terms, instead of reporting its own RHS.
        knots = sorted({point for interval in self.intervals for point in interval})
        before = moments(self.profile, knots, 2*self.order)
        after = moments(lambda x: self.corrected(x, coefficients), knots, 2*self.order)
        residual = {name: after[name]-before[name]-discrepancy[name] for name in NAMES}
        refined_error = max(abs(residual[name])/scale for name, scale in zip(NAMES, self.scales))
        if refined_error > 1e-10*max(1., norm):
            raise ArithmeticError('Refined physical moment integrals failed the correction check')
        return {'coefficients': coefficients, 'iterations': iteration+1,
                'normalizedResidual': error, 'refinedResidual': residual,
                'A2NumericalSmallness': smallness, 'inverseInfinityNorm': self.inverse_norm,
                'minimumCorrectedSwirlSampled': minimum_e,
                'parameterDerivativesCertified': False, 'stressConeCertified': False}
