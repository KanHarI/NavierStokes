"""Local analytic core from equations (4.7), (4.13), and (B.15).

Radial Taylor coefficients are constructed recursively, with Taylor jets in eta
carrying the required parameter derivatives. This solves the local leading
profile equations for diagnostic axis data; it does not join the exterior or
certify the theorem's finite-parameter/cone schedule.
"""

import math
from functools import lru_cache

from profile_parameters import AxisParameters, axis_amplitude_at


class _Jet:
    """Ordinary Taylor coefficients, not factorial-scaled derivatives."""

    def __init__(self, coefficients):
        self.c = tuple(coefficients)

    def constant(self, value):
        return _Jet((value,) + (0.0,) * (len(self.c) - 1))

    def __add__(self, other):
        if not isinstance(other, _Jet):
            other = self.constant(other)
        return _Jet(tuple(a + b for a, b in zip(self.c, other.c)))

    __radd__ = __add__

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other)

    def __rsub__(self, other):
        return -self + other

    def __mul__(self, other):
        if not isinstance(other, _Jet):
            return _Jet(tuple(a * other for a in self.c))
        return _Jet(tuple(math.fsum(self.c[k] * other.c[n-k]
                                   for k in range(n+1))
                          for n in range(len(self.c))))

    __rmul__ = __mul__

    def reciprocal(self):
        result = [1 / self.c[0]]
        for n in range(1, len(self.c)):
            result.append(-math.fsum(self.c[k] * result[n-k]
                                    for k in range(1, n+1)) / self.c[0])
        return _Jet(result)

    def __truediv__(self, other):
        return self * (other.reciprocal() if isinstance(other, _Jet) else 1/other)

    def derivative(self):
        return _Jet(tuple((n+1)*self.c[n+1] for n in range(len(self.c)-1)) + (0.0,))


def _product_coefficient(left, right, n):
    return sum((left[k] * right[n-k] for k in range(n+1)), left[0].constant(0))


@lru_cache(maxsize=2048)
def coefficients(eta, parameters=AxisParameters(), order=22):
    """Return radial series (Phi,U,Pi) in Y=lambda_*X at fixed eta.

    Extra eta degrees ensure derivatives through second order are available
    without differentiating an interpolated table. Increasing ``order`` gives
    an independent radial truncation refinement.
    """
    if not -1 <= eta <= 1 or not 2 <= order <= 32:
        raise ValueError("Require |eta|<=1 and 2<=order<=32")
    degree = order + 3
    e = _Jet((eta, 1.0) + (0.0,) * (degree-1))
    one, zero = e.constant(1), e.constant(0)
    h, lam = parameters.h, parameters.lambda_
    a, d_exp = .5+h, .5-h
    d, ell = 1-e*e, 1-2*h*e*e
    u_axis = 4*e + parameters.j0
    hc_axis = d_exp*e + d*u_axis
    xi = -lam*ell*hc_axis / (hc_axis*hc_axis + parameters.sigma**2)
    # g'=xi*g. This stable recurrence avoids exponentiating eta polynomials.
    g_coeff = [axis_amplitude_at(eta, parameters)]
    for n in range(degree):
        g_coeff.append(math.fsum(xi.c[k]*g_coeff[n-k] for k in range(n+1))/(n+1))
    g = _Jet(g_coeff)
    g_squared = g*g
    phi = [one]
    u = [u_axis]
    f = (1+e*e).reciprocal()
    pressure = [-parameters.pressure_scale*f*f]
    w, hc = [], []
    inv_scale = (2*lam*ell).reciprocal()
    for n in range(order):
        average = u[n]/(n+1)
        w.append(-2*d_exp*e*average-d*average.derivative()+(1 if n == 0 else 0))
        hc.append(d*u[n]+(d_exp*e if n == 0 else 0))
        angular = sum((w[k]*(1+n-k)*phi[n-k]
                       + hc[k]*(phi[n-k].derivative()+xi*phi[n-k])
                       for k in range(n+1)), zero)
        angular += h*phi[n] - 2*h*e*_product_coefficient(u, phi, n)
        axial = sum((w[k]*(n-k)*u[n-k] + hc[k]*u[n-k].derivative()
                     for k in range(n+1)), zero)
        axial += a*u[n]-2*a*e*_product_coefficient(u,u,n)
        axial += d*pressure[n].derivative()-(4*a+2*n)*e*pressure[n]
        phi.append(angular*inv_scale/((n+1)*(n+2)))
        u.append(axial*inv_scale/((n+1)**2))
        pressure.append(g_squared*_product_coefficient(phi,phi,n)/(lam*(n+1)))
    return tuple(phi), tuple(u), tuple(pressure), g, xi


def _evaluate(series, y, radial_derivative=0, eta_derivative=0, average=False):
    return math.fsum(
        coefficient.c[eta_derivative] * math.factorial(eta_derivative)
        * math.prod(range(n-radial_derivative+1, n+1))
        * y**(n-radial_derivative) / ((n+1) if average else 1)
        for n, coefficient in enumerate(series) if n >= radial_derivative)


def evaluate(y, eta, parameters=AxisParameters(), order=22):
    """Sample the local core in similarity coordinates Y=lambda_*X, eta.

    Returns F=E/sqrt(2X), U, v0=V0/X, Pi and derivatives with respect to
    X/eta. Use only inside a patch whose convergence has been checked.
    """
    if not math.isfinite(y) or y < 0 or not math.isfinite(eta):
        raise ValueError("Coordinates must be finite with Y>=0")
    phi, u, pressure, g, xi = coefficients(eta, parameters, order)
    lam, h = parameters.lambda_, parameters.h
    value = lambda series, ry=0, re=0, avg=False: _evaluate(series,y,ry,re,avg)
    p0, u0 = value(phi), value(u)
    ell, d = 1-2*h*eta*eta, 1-eta*eta
    average_u, average_u_eta = value(u,avg=True), value(u,re=1,avg=True)
    w = 1-2*(.5-h)*eta*average_u-d*average_u_eta
    hc = (.5-h)*eta+d*u0
    f = g.c[0]*p0
    f_eta = g.c[0]*(value(phi,re=1)+xi.c[0]*p0)
    f_x = g.c[0]*lam*value(phi,ry=1)
    f_xx = g.c[0]*lam*lam*value(phi,ry=2)
    ux, uxx, ueta = lam*value(u,ry=1), lam*lam*value(u,ry=2), value(u,re=1)
    pix, pieta = lam*value(pressure,ry=1), value(pressure,re=1)
    x = y/lam
    sq = -w*(1+x*f_x/f)-h*(1-2*eta*u0)-hc*f_eta/f
    sn = (-w*x*ux-(.5+h)*(1-2*eta*u0)*u0-hc*ueta
          -d*pieta+4*(.5+h)*eta*value(pressure)+2*eta*x*pix)
    angular_lhs = -2*ell*(x*f_xx+2*f_x)/f
    axial_lhs = -2*ell*(x*uxx+ux)
    # Derivatives of v0 from the incompressibility integral, retaining eta jets.
    e = _Jet((eta,1.0)+(0.0,)*(len(g.c)-2))
    zero = e.constant(0)
    v_jets = []
    for derivative in range(3):
        uj, avj = zero, zero
        for n in range(derivative,len(u)):
            term = u[n] * (math.prod(range(n-derivative+1,n+1))
                           * y**(n-derivative)*lam**derivative)
            uj += term
            avj += term/(n+1)
        v_jets.append((2*e*uj-2*(.5-h)*e*avj-(1-e*e)*avj.derivative())
                      /(1-2*h*e*e))
    return {
        "F": f, "U": u0, "v0": (w-1+2*eta*u0)/ell,
        "Pi": value(pressure), "F_X": f_x, "F_eta": f_eta,
        "U_X": ux, "U_eta": ueta, "Pi_X": pix, "Pi_eta": pieta,
        "F_XX": f_xx, "F_Xeta": g.c[0]*lam*(value(phi,ry=1,re=1)
                                                   +xi.c[0]*value(phi,ry=1)),
        "F_etaeta": g.c[0]*(value(phi,re=2)+2*xi.c[0]*value(phi,re=1)
                            +(xi.c[1]+xi.c[0]**2)*p0),
        "U_XX": uxx, "U_Xeta": lam*value(u,ry=1,re=1),
        "U_etaeta": value(u,re=2),
        "v0_X": v_jets[1].c[0], "v0_eta": v_jets[0].c[1],
        "v0_XX": v_jets[2].c[0], "v0_Xeta": v_jets[1].c[1],
        "v0_etaeta": 2*v_jets[0].c[2],
        "Phi": p0,
        "angular_residual": angular_lhs-sq,
        "axial_residual": axial_lhs-sn,
        "pressure_residual": pix-f*f,
        "angular_relative_residual": abs(angular_lhs-sq)/(1+abs(sq)),
        "axial_relative_residual": abs(axial_lhs-sn)/(1+abs(sn)),
        "pressure_relative_residual": abs(pix-f*f)/(1+f*f),
    }


def velocity(x, y, z, time, parameters=AxisParameters(), order=22):
    """Cartesian local-core velocity (4.5), restricted to validated patch."""
    from heat_exterior import similarity_coordinates
    q, eta, radius_x = similarity_coordinates(math.hypot(x,y),z,time,parameters.h)
    radial_y = parameters.lambda_*radius_x
    if radial_y > 4.1:
        raise ValueError("Outside validated local core Y<=4.1; no exterior matching")
    p = evaluate(radial_y,eta,parameters,order)
    swirl = q**(-1-parameters.h)*p["F"]
    radial = p["v0"]/(2*q)
    return (radial*x-swirl*y,radial*y+swirl*x,q**(-.5-parameters.h)*p["U"])


def physical_pressure(x,y,z,time,parameters=AxisParameters(),order=22):
    """Local approximation pressure per density, without global normalization."""
    from heat_exterior import similarity_coordinates
    q,eta,radius_x=similarity_coordinates(math.hypot(x,y),z,time,parameters.h)
    if parameters.lambda_*radius_x > 4.1:
        raise ValueError("Outside validated local core Y<=4.1")
    return q**(-1-2*parameters.h)*evaluate(parameters.lambda_*radius_x,eta,parameters,order)["Pi"]


def external_acceleration(x,y,z,time,parameters=AxisParameters(),order=22):
    """Full du/dt + (u.grad)u - Laplacian(u) + grad(p), viscosity one.

    This is the force per unit mass REQUIRED BY THE LOCAL APPROXIMATION,
    not the full construction's smooth forcing. Profile derivatives are used
    before compression, with the small finite-series pressure mismatch retained.
    """
    from heat_exterior import similarity_coordinates
    q,eta,xx=similarity_coordinates(math.hypot(x,y),z,time,parameters.h)
    if parameters.lambda_*xx > 4.1:
        raise ValueError("Outside validated local core Y<=4.1")
    p=evaluate(parameters.lambda_*xx,eta,parameters,order)
    h=parameters.h
    a,dexp=.5+h,.5-h
    ell,d=1-2*h*eta*eta,1-eta*eta

    def temporal(b,f,fx,fe):
        return (-b*f+dexp*eta*fe+xx*fx)/ell

    def axial(b,f,fx,fe):
        return (2*b*eta*f+d*fe-2*eta*xx*fx)/ell

    def jet(field,scale=1):
        return tuple(p[field+suffix]*scale for suffix in
                     ("","_X","_eta","_XX","_Xeta","_etaeta"))

    def axial_twice(b,values):
        f,fx,fe,fxx,fxe,fee=values
        numerator=2*b*eta*f+d*fe-2*eta*xx*fx
        nx=2*(b-1)*eta*fx+d*fxe-2*eta*xx*fxx
        ne=2*b*f+2*(b-1)*eta*fe+d*fee-2*xx*fx-2*eta*xx*fxe
        return axial(b-dexp,numerator/ell,nx/ell,
                     ne/ell+4*h*eta*numerator/(ell*ell))

    fj,uj,gj=jet("F"),jet("U"),jet("v0",.5)
    f,fx,fe,fxx,_,_=fj
    u,ux,ue,uxx,_,_=uj
    g,gx,ge,gxx,_,_=gj
    b=-1-h
    btheta=(temporal(b,f,fx,fe)+2*g*(f+xx*fx)
            +u*axial(b,f,fx,fe)-4*fx-2*xx*fxx)
    bz=(temporal(-a,u,ux,ue)+2*xx*g*ux+u*axial(-a,u,ux,ue)
        +axial(-2*a,p["Pi"],p["Pi_X"],p["Pi_eta"])-2*ux-2*xx*uxx)
    br=(temporal(-1,g,gx,ge)+g*(g+2*xx*gx)+u*axial(-1,g,gx,ge)
        -4*gx-2*xx*gxx)
    radial=(q**(-2)*br-q**(-1-2*dexp)*axial_twice(-1,gj)
            +q**(-2*a-1)*(p["Pi_X"]-f*f))
    angular=q**(b-1)*btheta-q**(b-2*dexp)*axial_twice(b,fj)
    axial_force=q**(-a-1)*bz-q**(-a-2*dexp)*axial_twice(-a,uj)
    return (x*radial-y*angular,y*radial+x*angular,axial_force)
