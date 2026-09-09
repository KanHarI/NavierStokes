"""Finite-time forced diagnostic continuation of the computed source core.

The core is unchanged for Y<=4.1 and physical R<=4. Elsewhere a smooth
streamfunction continuation joins its meridional velocity to rest and its
swirl to the source heat exterior. A physical curl cutoff makes R>=8 rest.
This is not the paper's five-moment/cone matched construction.
"""
from functools import lru_cache
import math

from core_profiles import coefficients
from heat_exterior import heat_factor, simpson
from profile_parameters import AxisParameters
from pressure_match import SwirlPressureMatch

REFERENCE_BASE, REFERENCE_WIDTH = 4.1, .005
REFERENCE_START = REFERENCE_BASE*math.exp(REFERENCE_WIDTH)
REFERENCE_END = REFERENCE_BASE*math.exp(2*REFERENCE_WIDTH)
JOIN_START, JOIN_END = 4.9, 16.
LOCALIZATION_START, LOCALIZATION_END = 4., 8.
C_INFINITY = .02


def smooth_step(argument):
    """C-infinity step and its first derivative, including flat endpoints."""
    if argument <= 0:
        return 0., 0.
    if argument >= 1:
        return 1., 0.
    left, right = math.exp(-1/argument), math.exp(-1/(1-argument))
    value = left/(left+right)
    if value == 0 or value == 1:
        return value, 0.
    return value, value*(1-value)*(1/argument**2+1/(1-argument)**2)


def source_step(argument):
    """The specific exp(-1/s²) step fixed in source equation A.5."""
    if argument<=0:
        return 0.
    if argument>=1:
        return 1.
    left,right=math.exp(-1/argument**2),math.exp(-1/(1-argument)**2)
    return left/(left+right)


def _evaluate(series, y, component=0, integral=False):
    result = 0.
    for n in range(len(series)-1,-1,-1):
        coefficient = series[n].c[component]/(n+1) if integral else series[n].c[component]
        result = result*y+coefficient
    return result*y if integral else result


def _differentiate(series,y,component=0):
    result=0.
    for n in range(len(series)-1,0,-1):
        result=result*y+n*series[n].c[component]
    return result


def reference_weight(y):
    """Exactly the logarithmic derivative taper in source equation B.22."""
    if y<=REFERENCE_START:
        return 1.
    if y>=REFERENCE_END:
        return 0.
    return 1-source_step((math.log(y/REFERENCE_BASE)-REFERENCE_WIDTH)/REFERENCE_WIDTH)


def _reference_integrals(end,phi,u,intervals=128):
    """Integrals of U_Y, Y U_Y, U_Yeta, Y U_Yeta and (log F)_Y."""
    if end<=REFERENCE_START:
        return (0.,)*5
    step=(end-REFERENCE_START)/intervals
    sums=[[] for _ in range(5)]
    for i in range(intervals+1):
        y=REFERENCE_START+i*step
        factor=(1 if i in (0,intervals) else 4 if i%2 else 2)*reference_weight(y)
        uy,ueta=_differentiate(u,y),_differentiate(u,y,1)
        angular=_differentiate(phi,y)/_evaluate(phi,y)
        for terms,value in zip(sums,(uy,y*uy,ueta,y*ueta,angular)):
            terms.append(factor*value)
    return tuple(math.fsum(terms)*step/3 for terms in sums)


@lru_cache(maxsize=2048)
def _reference_endpoint(eta,parameters,order):
    return _reference_transition(REFERENCE_END,eta,parameters,order)


def _reference_transition(y,eta,parameters,order):
    phi,u,p,g,_=coefficients(eta,parameters,order)
    lam=parameters.lambda_
    initial_u=_evaluate(u,REFERENCE_START)
    initial_ueta=_evaluate(u,REFERENCE_START,1)
    initial_j=_evaluate(u,REFERENCE_START,integral=True)/lam
    initial_jeta=_evaluate(u,REFERENCE_START,component=1,integral=True)/lam
    initial_f=g.c[0]*_evaluate(phi,REFERENCE_START)
    i0,i1,e0,e1,angular=_reference_integrals(y,phi,u)
    return {"J":initial_j+((y-REFERENCE_START)*initial_u+y*i0-i1)/lam,
            "J_eta":initial_jeta+((y-REFERENCE_START)*initial_ueta+y*e0-e1)/lam,
            "U":initial_u+i0,"U_eta":initial_ueta+e0,
            "F":initial_f*math.exp(angular)}


def reference_profile(y,eta,parameters=AxisParameters(),order=22):
    """Literal B.22 reference field and its exact radial primitive.

    The numerical attachment radius is 4.1/Lambda to preserve the whole
    existing core. No claim about B.23 cone bounds is attached to that choice.
    """
    if y<=REFERENCE_START:
        phi,u,p,g,_=coefficients(eta,parameters,order)
        return {"J":_evaluate(u,y,integral=True)/parameters.lambda_,
                "J_eta":_evaluate(u,y,component=1,integral=True)/parameters.lambda_,
                "U":_evaluate(u,y),"U_eta":_evaluate(u,y,1),
                "F":g.c[0]*_evaluate(phi,y)}
    if y<REFERENCE_END:
        return _reference_transition(y,eta,parameters,order)
    endpoint=_reference_endpoint(eta,parameters,order)
    extra=y-REFERENCE_END
    return {**endpoint,"J":endpoint["J"]+extra*endpoint["U"]/parameters.lambda_,
            "J_eta":endpoint["J_eta"]+extra*endpoint["U_eta"]/parameters.lambda_}


@lru_cache(maxsize=2048)
def _reference_pressure_endpoint(eta,parameters,order):
    _,_,p,_,_=coefficients(eta,parameters,order)
    return (_evaluate(p,REFERENCE_START)
            +simpson(lambda y:reference_profile(y,eta,parameters,order)["F"]**2,
                     REFERENCE_START,REFERENCE_END,64)/parameters.lambda_)


def reference_pressure(y,eta,parameters=AxisParameters(),order=22):
    """B.24 pressure recovered from the continued radial swirl energy."""
    if y<=REFERENCE_START:
        return _evaluate(coefficients(eta,parameters,order)[2],y)
    if y>=REFERENCE_END:
        return (_reference_pressure_endpoint(eta,parameters,order)
                +(y-REFERENCE_END)*_reference_endpoint(eta,parameters,order)["F"]**2/parameters.lambda_)
    return (_evaluate(coefficients(eta,parameters,order)[2],REFERENCE_START)
            +simpson(lambda s:reference_profile(s,eta,parameters,order)["F"]**2,
                     REFERENCE_START,y,64)/parameters.lambda_)


def base_profile(y, eta, parameters=AxisParameters(), c_infinity=C_INFINITY, order=22,
                 include_pressure=False):
    """Unmatched J=integral U dX, J_eta, J_Y and F before pressure correction.

    Velocity is reconstructed by differentiating the actual continued J.
    For y>=16, J and its derivatives are exactly zero and F is the heat
    exterior; the browser may evaluate that branch procedurally.
    """
    if not math.isfinite(y) or y < 0 or not math.isfinite(eta) or abs(eta)>1:
        raise ValueError("Require finite Y>=0 and eta in [-1,1]")
    if not math.isfinite(c_infinity) or c_infinity <= 0:
        raise ValueError("Require a positive finite exterior amplitude")
    step, derivative = smooth_step((y-JOIN_START)/(JOIN_END-JOIN_START))
    weight, weight_y = 1-step, -derivative/(JOIN_END-JOIN_START)
    f_heat = 0.
    if weight < 1:
        x = y/parameters.lambda_
        f_heat = (c_infinity*x**(-1-parameters.h)/math.sqrt(2)
                  *heat_factor(2*(1-eta*eta)/x,parameters.h))
    if weight == 0:
        return {"J":0.,"J_eta":0.,"J_Y":0.,"J_Yeta":0.,"F":f_heat,"Pi":0.,
                "weight":0.,"J_over_Y":0.,"J_eta_over_Y":0.}
    reference=reference_profile(y,eta,parameters,order)
    primitive,primitive_eta=reference["J"],reference["J_eta"]
    primitive_y=reference["U"]/parameters.lambda_
    primitive_yeta=reference["U_eta"]/parameters.lambda_
    j = weight*primitive
    j_eta = weight*primitive_eta
    j_y = weight_y*primitive+weight*primitive_y
    j_yeta = weight_y*primitive_eta+weight*primitive_yeta
    f = weight*reference["F"]+(1-weight)*f_heat
    result={"J":j,"J_eta":j_eta,"J_Y":j_y,"J_Yeta":j_yeta,"F":f,
            "weight":weight,
            "J_over_Y":j/y if y else reference["U"]/parameters.lambda_,
            "J_eta_over_Y":j_eta/y if y else reference["U_eta"]/parameters.lambda_}
    if include_pressure:
        result["Pi"]=reference_pressure(y,eta,parameters,order)
    return result


@lru_cache(maxsize=16)
def pressure_matcher(parameters=AxisParameters(),c_infinity=C_INFINITY,order=22):
    return SwirlPressureMatch(lambda y,eta:base_profile(y,eta,parameters,c_infinity,order),
                             parameters,c_infinity,JOIN_END)


def profile(y,eta,parameters=AxisParameters(),c_infinity=C_INFINITY,order=22,
            include_pressure=False):
    """Continued primitive and swirl, with the full radial pressure moment matched.

    Request include_pressure=True for Pi as well; velocity/table generation
    does not need to repeat the pressure integral at every radial sample.
    """
    result=base_profile(y,eta,parameters,c_infinity,order)
    matcher=pressure_matcher(parameters,c_infinity,order)
    bump=matcher.bump(y)
    if bump:
        result["F"]=math.sqrt(result["F"]**2+matcher.amplitude(eta)*bump)
    if include_pressure:
        result["Pi"]=matcher.pressure(y,eta)
    return result


def coordinates(radius, z, time, parameters=AxisParameters()):
    """Global fixed point; its contraction is at most 2h from this start."""
    if not all(math.isfinite(value) for value in (radius,z,time)) or radius<0 or time>=1:
        raise ValueError("Require finite r>=0,z,t<1")
    tau, d_exp = 1-time, .5-parameters.h
    q = max(tau,abs(z)**(1/d_exp))
    for _ in range(10):
        q = tau+z*z*q**(2*parameters.h)
    return q, parameters.lambda_*radius*radius/(2*q), z/q**d_exp


def physical_cutoff(x,y,z):
    """C(R), C_r/r and C_z. R² avoids a nonsmooth norm at the origin."""
    radius = math.hypot(x,y,z)
    if radius <= LOCALIZATION_START:
        return 1.,0.,0.
    if radius >= LOCALIZATION_END:
        return 0.,0.,0.
    width = LOCALIZATION_END**2-LOCALIZATION_START**2
    step, derivative = smooth_step((radius*radius-LOCALIZATION_START**2)/width)
    return 1-step,-2*derivative/width,-2*z*derivative/width


def _validate_position(x,y,z,time):
    if not all(math.isfinite(v) for v in (x,y,z,time)) or time>=1:
        raise ValueError("Require a finite position and time<1")


def velocity(x,y,z,time,parameters=AxisParameters(),c_infinity=C_INFINITY,order=22):
    """Every finite physical position has a defined velocity for t<1."""
    _validate_position(x,y,z,time)
    cutoff,cutoff_r_over_r,cutoff_z = physical_cutoff(x,y,z)
    if cutoff == 0:
        return (0.,0.,0.)
    q,radial_y,eta = coordinates(math.hypot(x,y),z,time,parameters)
    p = profile(radial_y,eta,parameters,c_infinity,order)
    lam,h,d_exp = parameters.lambda_,parameters.h,.5-parameters.h
    ell,d = 1-2*h*eta*eta,1-eta*eta
    # J=O(Y) makes these Cartesian rates smooth at r=0.
    radial_rate = -lam*(2*d_exp*eta*p["J_over_Y"]+d*p["J_eta_over_Y"]
                        -2*eta*p["J_Y"])/(2*q*ell)
    stream_over_r2 = lam*q**(-.5-h)*p["J_over_Y"]/2
    radial_rate = cutoff*radial_rate-cutoff_z*stream_over_r2
    axial = cutoff*q**(-.5-h)*lam*p["J_Y"]
    axial += cutoff_r_over_r*q**d_exp*p["J"]
    rotation = cutoff*q**(-1-h)*p["F"]
    return (radial_rate*x-rotation*y,radial_rate*y+rotation*x,axial)


@lru_cache(maxsize=1024)
def heat_pressure(radius,time,h,c_infinity,intervals=512):
    """Exact heat pressure quadrature, zero at radial infinity."""
    a = .5+h
    argument = 4*(1-time)/radius**2
    integral = simpson(lambda s: math.exp(-4*a*s)*heat_factor(argument*math.exp(-2*s),h)**2,
                       0.,24.,intervals)
    return -c_infinity**2*(radius*radius/2)**(-2*a)*integral


def pressure(x,y,z,time,parameters=AxisParameters(),c_infinity=C_INFINITY,order=22):
    """Pressure moment matched to the core datum and zero at radial infinity.

    Physical localization multiplies this pressure by C, as in source 10.4.
    The source's other radial moments and stress cone remain uncertified.
    """
    _validate_position(x,y,z,time)
    cutoff,_,_ = physical_cutoff(x,y,z)
    if cutoff == 0:
        return 0.
    radius = math.hypot(x,y)
    q,radial_y,eta = coordinates(radius,z,time,parameters)
    pi=pressure_matcher(parameters,c_infinity,order).pressure(radial_y,eta)
    return cutoff*q**(-1-2*parameters.h)*pi


def force(x,y,z,time,parameters=AxisParameters(),c_infinity=C_INFINITY,order=22,step=None):
    """Full manufactured acceleration from independent physical finite differences.

    This diagnostic includes advection, all three viscous components, pressure,
    and time variation of the continuation/cutoffs. Refining ``step`` checks
    its numerical accuracy; this is not a smooth-force claim at t=1.
    """
    _validate_position(x,y,z,time)
    if math.hypot(x,y,z)>=LOCALIZATION_END:
        return (0.,0.,0.)
    ds = 2e-4*min(1.,math.sqrt(1-time)) if step is None else step
    if not math.isfinite(ds) or ds<=0:
        raise ValueError("Require a positive finite difference step")
    dt = min(ds*math.sqrt(1-time),.01*(1-time))
    position = [x,y,z]
    at = lambda pos,t: velocity(*pos,t,parameters,c_infinity,order)
    center = at(position,time)
    before,after = at(position,time-dt),at(position,time+dt)
    derivative = [(b-a)/(2*dt) for a,b in zip(before,after)]
    laplacian,advection,gradient = [0.]*3,[0.]*3,[0.]*3
    for axis in range(3):
        left,right = position[:],position[:]
        left[axis]-=ds
        right[axis]+=ds
        lo,hi = at(left,time),at(right,time)
        for component in range(3):
            advection[component] += center[axis]*(hi[component]-lo[component])/(2*ds)
            laplacian[component] += (hi[component]-2*center[component]+lo[component])/ds**2
        gradient[axis] = (pressure(*right,time,parameters,c_infinity,order)
                          -pressure(*left,time,parameters,c_infinity,order))/(2*ds)
    return tuple(derivative[i]+advection[i]-laplacian[i]+gradient[i] for i in range(3))
