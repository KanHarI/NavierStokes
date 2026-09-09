"""Measure incompressibility error of the shipped bilinear float32 table.

Unlike the analytic solver tests, these checks differentiate the actual
piecewise-bilinear interpolant. Its divergence is not identically zero.
"""

import json
import math
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "science/src"))
from heat_exterior import similarity_coordinates


class CoreLookup:
    def __init__(self, stride=1):
        base = ROOT / "web/public/datasets"
        self.manifest = json.loads((base/"core-manifest.json").read_text())
        core = self.manifest["core"]
        chunk = next(c for c in self.manifest["chunks"] if c["kind"] == "core-profile")
        raw = (base/chunk["url"]).read_bytes()
        full = struct.unpack("<"+"f"*(len(raw)//4),raw)
        self.ny = (core["yCount"]-1)//stride+1
        self.ne = (core["etaCount"]-1)//stride+1
        self.ymax,self.emax = core["yMax"],core["etaMax"]
        self.h,self.lam = self.manifest["model"]["h"],self.manifest["model"]["lambda"]
        self.values = [full[4*(j*core["yCount"]+i)+channel]
                       for j in range(0,core["etaCount"],stride)
                       for i in range(0,core["yCount"],stride)
                       for channel in range(4)]

    def profiles(self,y,eta):
        if not 0<=y<=self.ymax or not -self.emax<=eta<=self.emax:
            raise ValueError("Outside lookup")
        fy,fe = y/self.ymax*(self.ny-1),(eta/self.emax+1)/2*(self.ne-1)
        i,j = min(int(fy),self.ny-2),min(int(fe),self.ne-2)
        a,b = fy-i,fe-j
        result=[]
        for channel in range(4):
            p00,p10,p01,p11 = [self.values[4*(v*self.ny+u)+channel]
                              for u,v in ((i,j),(i+1,j),(i,j+1),(i+1,j+1))]
            value=(1-b)*((1-a)*p00+a*p10)+b*((1-a)*p01+a*p11)
            derivative_x=((1-b)*(p10-p00)+b*(p11-p01))*(self.ny-1)/self.ymax*self.lam
            derivative_eta=((1-a)*(p01-p00)+a*(p11-p10))*(self.ne-1)/(2*self.emax)
            result.append((value,derivative_x,derivative_eta))
        return result

    def velocity_and_gradient(self,point,time):
        x,y,z=point
        q,eta,X=similarity_coordinates(math.hypot(x,y),z,time,self.h)
        F,U,v0,_=self.profiles(self.lam*X,eta)
        G=tuple(v/2 for v in v0)
        A,D=.5+self.h,.5-self.h
        B=-1-self.h
        L,d=1-2*self.h*eta*eta,1-eta*eta
        def axial(profile,exponent):
            value,dx,de=profile
            return (2*exponent*eta*value+d*de-2*eta*X*dx)/L
        a,b=q**-1*G[0],q**B*F[0]
        ax,ay=q**-2*G[1]*x,q**-2*G[1]*y
        bx,by=q**(B-1)*F[1]*x,q**(B-1)*F[1]*y
        az,bz=q**(-1-D)*axial(G,-1),q**(B-D)*axial(F,B)
        jacobian=((a+ax*x-bx*y,ay*x-b-by*y,az*x-bz*y),
                  (ax*y+b+bx*x,a+ay*y+by*x,az*y+bz*x),
                  (q**(-A-1)*U[1]*x,q**(-A-1)*U[1]*y,q**-1*axial(U,-A)))
        return (a*x-b*y,a*y+b*x,q**-A*U[0]),jacobian


def lookup_diagnostics(sample_count=1024):
    result=[]
    for stride in (4,2,1):
        table=CoreLookup(stride)
        strains,gradients,divergences=[],[],[]
        for i in range(sample_count):
            # Fixed off-grid points shared by all resolutions, uniform in Y/eta.
            Y=table.ymax*(i+.37)/sample_count
            eta=table.emax*(2*((i*.6180339887498949+.2718281828)%1)-1)
            tau=(1,.1,.01,.0001)[i%4]
            q=tau/(1-eta*eta)
            r=math.sqrt(2*q*Y/table.lam)
            point=(r*math.cos(.73),r*math.sin(.73),q**(.5-table.h)*eta)
            _,jac=table.velocity_and_gradient(point,1-tau)
            divergence=abs(sum(jac[k][k] for k in range(3)))
            gradient=math.sqrt(sum(v*v for row in jac for v in row))
            strain=math.sqrt(sum(((jac[i][j]+jac[j][i])/2)**2 for i in range(3) for j in range(3)))
            divergences.append(divergence)
            strains.append(divergence/max(strain,1e-30))
            gradients.append(divergence/max(gradient,1e-30))
        strains.sort()
        result.append({"yCount":table.ny,"etaCount":table.ne,"samples":sample_count,
                       "maxAbsoluteDivergence":max(divergences),
                       "maxDivergenceOverStrain":max(strains),
                       "rmsDivergenceOverStrain":math.sqrt(sum(v*v for v in strains)/len(strains)),
                       "medianDivergenceOverStrain":strains[len(strains)//2],
                       "p95DivergenceOverStrain":strains[int(.95*len(strains))],
                       "maxDivergenceOverGradient":max(gradients)})
    return result


class CoreLookupTests(unittest.TestCase):
    def test_exported_divergence_is_measured_and_improves(self):
        levels=lookup_diagnostics()
        self.assertLess(levels[-1]["maxDivergenceOverStrain"],.012)
        self.assertLess(levels[-1]["rmsDivergenceOverStrain"],.0035)
        for coarse,fine in zip(levels,levels[1:]):
            self.assertLess(fine["rmsDivergenceOverStrain"],coarse["rmsDivergenceOverStrain"]*.7)

    def test_interpolant_gradient_against_cartesian_difference(self):
        table=CoreLookup()
        point,time=(.053,.031,.023),.8
        _,jacobian=table.velocity_and_gradient(point,time)
        step=1e-7
        for axis in range(3):
            left,right=list(point),list(point)
            left[axis]-=step
            right[axis]+=step
            before,_=table.velocity_and_gradient(left,time)
            after,_=table.velocity_and_gradient(right,time)
            for component in range(3):
                measured=(after[component]-before[component])/(2*step)
                self.assertAlmostEqual(measured,jacobian[component][axis],delta=1e-7*(1+abs(measured)))


if __name__ == "__main__":
    unittest.main()
