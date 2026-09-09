"""Match the actual radial pressure moment with a positive annular swirl bump.

This enforces Pi_X=F² and Pi(infinity)=0 with the existing axis datum.
It does not enforce the source's other radial moments or stress cone.
"""

from functools import lru_cache
import math

from heat_exterior import heat_factor
from profile_parameters import AxisParameters, pressure_datum


@lru_cache(maxsize=16)
def gauss_legendre(order):
    """Standard double-precision Legendre nodes and weights on [-1,1]."""
    if not isinstance(order,int) or order<2:
        raise ValueError("Quadrature order must be an integer >=2")
    nodes=[]
    for index in range(1,order+1):
        root=math.cos(math.pi*(index-.25)/(order+.5))
        for _ in range(64):
            previous,current=1.,root
            for degree in range(2,order+1):
                previous,current=current,((2*degree-1)*root*current-(degree-1)*previous)/degree
            derivative=order*(root*current-previous)/(root*root-1)
            corrected=root-current/derivative
            if abs(corrected-root)<2e-16:
                root=corrected
                break
            root=corrected
        # Re-evaluate after the final Newton update to avoid stale weights.
        previous,current=1.,root
        for degree in range(2,order+1):
            previous,current=current,((2*degree-1)*root*current-(degree-1)*previous)/degree
        derivative=order*(root*current-previous)/(root*root-1)
        nodes.append((root,2/((1-root*root)*derivative*derivative)))
    return tuple(nodes)


def integrate(function,start,end,order=32):
    if end<=start:
        return 0.
    midpoint,half=(start+end)/2,(end-start)/2
    return half*math.fsum(weight*function(midpoint+half*node)
                          for node,weight in gauss_legendre(order))


def _bump_shape(s):
    return math.exp(-1/(s*(1-s))) if 0<s<1 else 0.


class SwirlPressureMatch:
    """A base callback returns an unmatched {'F': scalar} profile in Y,eta.

    The callback must equal the heat exterior from join_end onward. No source
    field module is imported here, so callers can wrap their base safely.
    """
    def __init__(self,base_profile,parameters=AxisParameters(),c_infinity=.02,
                 join_end=16.,bump_start=6.,bump_end=14.,quadrature_order=32):
        if not callable(base_profile) or not 0<bump_start<bump_end<join_end:
            raise ValueError("Require a callable profile and annular bump inside the heat join")
        if not math.isfinite(c_infinity) or c_infinity<=0:
            raise ValueError("Exterior amplitude must be positive and finite")
        self.base_profile=base_profile
        self.parameters=parameters
        self.c_infinity=c_infinity
        self.join_end=join_end
        self.bump_start,self.bump_end=bump_start,bump_end
        self.order=quadrature_order
        self.bump_normalization=integrate(_bump_shape,0,1,64)
        self._amplitudes={}

    def bump(self,y):
        """b(Y) normalized so integral b(Y) dX=1, X=Y/lambda."""
        width=self.bump_end-self.bump_start
        return self.parameters.lambda_/width*_bump_shape((y-self.bump_start)/width)/self.bump_normalization

    def bump_prefix(self,y):
        if y<=self.bump_start:
            return 0.
        if y>=self.bump_end:
            return 1.
        s=(y-self.bump_start)/(self.bump_end-self.bump_start)
        return integrate(_bump_shape,0,s,64)/self.bump_normalization

    def _base(self,y,eta):
        value=self.base_profile(y,eta)["F"]
        if not math.isfinite(value) or value<0:
            raise ArithmeticError("Base swirl profile is nonfinite or negative")
        return value

    def integrate_base(self,start,end,eta,order=None):
        """Finite Y interval; splitting resolves all declared continuation edges."""
        if start<0 or end>self.join_end:
            raise ValueError("Finite integral must lie before the heat join")
        knots=sorted(set([start,end]+[v for v in (1.,2.,3.,4.,4.1,4.1*math.exp(.005),
                                                 4.1*math.exp(.01),4.5,4.9,6.,8.,10.,12.,14.)
                                     if start<v<end]))
        return math.fsum(integrate(lambda y:self._base(y,eta)**2,a,b,order or self.order)
                         for a,b in zip(knots,knots[1:]))/self.parameters.lambda_

    def heat_tail(self,y,eta,order=None):
        """Integral_X^infinity F_heat² dX, via logarithmic radial coordinate."""
        if y<=0 or not -1<=eta<=1:
            raise ValueError("Heat tail requires Y>0 and |eta|<=1")
        x=y/self.parameters.lambda_
        h=self.parameters.h
        argument=2*(1-eta*eta)/x
        integral=integrate(lambda s:math.exp(-(1+2*h)*s)
                           *heat_factor(argument*math.exp(-s),h)**2,0,40,order or 64)
        return self.c_infinity**2/2*x**(-1-2*h)*integral

    def amplitude(self,eta):
        if not math.isfinite(eta) or abs(eta)>1:
            raise ValueError("Require finite eta in [-1,1]")
        if eta not in self._amplitudes:
            baseline=self.integrate_base(0,self.join_end,eta)+self.heat_tail(self.join_end,eta)
            amount=-pressure_datum(eta,self.parameters)-baseline
            if not math.isfinite(amount) or amount<0:
                raise ArithmeticError("Axis pressure cannot be matched by a positive annular energy bump")
            self._amplitudes[eta]=amount
        return self._amplitudes[eta]

    def swirl(self,y,eta):
        base=self._base(y,eta)
        weight=self.bump(y)
        if weight==0:
            return base
        return math.sqrt(base*base+self.amplitude(eta)*weight)

    def pressure(self,y,eta):
        """Pi=-integral_X^infinity F_matched²dX, per unit density."""
        if not math.isfinite(y) or y<0 or not math.isfinite(eta) or abs(eta)>1:
            raise ValueError("Require Y>=0, |eta|<=1")
        if y>=self.join_end:
            return -self.heat_tail(y,eta)
        # Prefix form inside the bump avoids cancellation between almost
        # complete tail integrals near the axis and preserves the datum.
        if y<=self.bump_start:
            return pressure_datum(eta,self.parameters)+self.integrate_base(0,y,eta)
        tail=self.integrate_base(y,self.join_end,eta)+self.heat_tail(self.join_end,eta)
        return -tail-self.amplitude(eta)*(1-self.bump_prefix(y))

    def diagnostics(self,eta):
        amplitude=self.amplitude(eta)
        baseline=self.integrate_base(0,self.join_end,eta)
        refined=self.integrate_base(0,self.join_end,eta,order=2*self.order)
        return {"eta":eta,"addedAnnularPressureMoment":amplitude,
                "basePressureMoment":baseline+self.heat_tail(self.join_end,eta),
                "quadratureRefinementDifference":abs(refined-baseline),
                "matchedPressureMoment":-pressure_datum(eta,self.parameters),
                "remainingGlobalMomentsMatched":False,"stressConeCertified":False}
