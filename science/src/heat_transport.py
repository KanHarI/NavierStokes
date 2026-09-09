"""Reference angular transport in the pure heat-exterior branch.

Only use this shortcut when the complete trajectory is in that branch.
For forward field time, Y>=16 initially guarantees it remains there: r,z
are fixed, q decreases, and Y=lambda*r²/(2q) increases.
"""

import math

from heat_exterior import heat_factor

# Positive Gauss-Legendre nodes and their paired weights on [-1,1].
HEAT_NODES=(.1834346424956498,.5255324099163290,.7966664774136267,.9602898564975363)
HEAT_WEIGHTS=(.3626837833783620,.3137066458778873,.2223810344533745,.1012285362903763)


def heat_angular_displacement(radius,tau_start,tau_end,transport_delta,h=.005,
                              c_infinity=.02,cutoff=1.,factor=heat_factor):
    """Integrate angle with eight field samples; frozen-time rotation is exact.

    ``transport_delta`` is signed dust transport time. It need not equal
    tau_start-tau_end. A fixed spatial cutoff is constant on this circle.
    The injected ``factor`` permits independently testing a browser lookup.
    """
    if not all(math.isfinite(v) for v in (radius,tau_start,tau_end,transport_delta,h,c_infinity,cutoff)):
        raise ValueError("Angular integration arguments must be finite")
    if radius<=0 or tau_end<=0 or tau_start<tau_end or not 0<h<.01 or c_infinity<=0 or not 0<=cutoff<=1:
        raise ValueError("Require positive radius/time, forward field time, and valid model parameters")
    if transport_delta==0 or cutoff==0:
        return 0.
    amplitude=transport_delta*cutoff*c_infinity*(radius*radius/2)**(-.5-h)/radius
    if tau_start==tau_end:
        return amplitude*factor(4*tau_start/(radius*radius),h)
    midpoint,half=(tau_start+tau_end)/2,(tau_start-tau_end)/2
    mean=math.fsum(weight*(factor(4*(midpoint+half*node)/(radius*radius),h)
                           +factor(4*(midpoint-half*node)/(radius*radius),h))
                   for node,weight in zip(HEAT_NODES,HEAT_WEIGHTS))/2
    return amplitude*mean


def rotate_heat_particle(position,angle):
    """Exact geometric circle update (up to float arithmetic)."""
    x,y,z=position
    cosine,sine=math.cos(angle),math.sin(angle)
    return cosine*x-sine*y,sine*x+cosine*y,z
