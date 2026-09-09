/** Curl reconstruction of the tabulated streamfunction; no core-domain crop. */
export const EXTENDED_GLSL = `
vec4 hermiteBasis(float t){return vec4(2.*t*t*t-3.*t*t+1.,t*t*t-2.*t*t+t,-2.*t*t*t+3.*t*t,t*t*t-t*t);}
vec4 hermiteDerivative(float t){return vec4(6.*t*t-6.*t,3.*t*t-4.*t+1.,-6.*t*t+6.*t,3.*t*t-2.*t);}
vec4 primitiveRow(vec4 a,vec4 b,vec4 w,vec4 dw,float h){
  vec4 values=vec4(a.x,h*a.y,b.x,h*b.y),etaValues=vec4(a.z,h*a.w,b.z,h*b.w);
  return vec4(dot(w,values),dot(dw,values)/h,dot(w,etaValues),dot(dw,etaValues)/h);
}
vec4 extendedProfile(float Y,float eta){
  ivec2 size=textureSize(uProfile,0);
  vec2 spacing=vec2(uCoreDomain.y,2.)/vec2(size-1);
  vec2 index=clamp(vec2(Y,eta+1.)/spacing,vec2(0.),vec2(size-1));
  ivec2 low=min(ivec2(floor(index)),size-2);vec2 t=index-vec2(low);
  vec4 wy=hermiteBasis(t.x),dy=hermiteDerivative(t.x),we=hermiteBasis(t.y),de=hermiteDerivative(t.y);
  vec4 row0=primitiveRow(texelFetch(uProfile,low,0),texelFetch(uProfile,low+ivec2(1,0),0),wy,dy,spacing.x);
  vec4 row1=primitiveRow(texelFetch(uProfile,low+ivec2(0,1),0),texelFetch(uProfile,low+ivec2(1,1),0),wy,dy,spacing.x);
  vec4 jValues=vec4(row0.x,spacing.y*row0.z,row1.x,spacing.y*row1.z);
  float J=dot(we,jValues),Jeta=dot(de,jValues)/spacing.y;
  float JY=dot(we,vec4(row0.y,spacing.y*row0.w,row1.y,spacing.y*row1.w));
  float F=mix(mix(texelFetch(uSwirl,low,0).r,texelFetch(uSwirl,low+ivec2(1,0),0).r,t.x),
    mix(texelFetch(uSwirl,low+ivec2(0,1),0).r,texelFetch(uSwirl,low+ivec2(1,1),0).r,t.x),t.y);
  return vec4(J,JY,Jeta,F);
}
vec3 extendedCoordinates(vec3 p,float tau){
  float D=.5-uModel.x;
  float q=max(tau,pow(abs(p.z),1./D));
  for(int i=0;i<6;i++)q=tau+p.z*p.z*pow(q,2.*uModel.x);
  return vec3(uCoreDomain.x*dot(p.xy,p.xy)/(2.*q),clamp(p.z/pow(q,D),-1.,1.),q);
}
vec3 extendedVelocity(vec3 p,float tau){
  float R2=dot(p,p),outer2=uCutoff.y*uCutoff.y,inner2=uCutoff.x*uCutoff.x;
  if(R2>=outer2)return vec3(0.);
  float C=1.,CrOverR=0.;
  if(R2>inner2){
    float width=outer2-inner2,s=(R2-inner2)/width;
    float a=exp(-1./s),b=exp(-1./(1.-s)),step=a/(a+b);
    C=1.-step;CrOverR=-2.*step*(1.-step)*(1./(s*s)+1./((1.-s)*(1.-s)))/width;
  }
  vec3 c=extendedCoordinates(p,tau);float Y=c.x,eta=c.y,q=c.z;
  if(Y>=uCoreDomain.y){
    float r2=dot(p.xy,p.xy),rotation=C*uModel.y*pow(r2/2.,-.5-uModel.x)*profile(4.*tau/r2)/sqrt(r2);
    return rotation*vec3(-p.y,p.x,0.);
  }
  vec4 f=extendedProfile(Y,eta);float D=.5-uModel.x,L=1.-2.*uModel.x*eta*eta;
  float jOverY=Y>0.?f.x/Y:f.y,jeOverY=Y>0.?f.z/Y:0.;
  float radial=-C*uCoreDomain.x*(2.*D*eta*jOverY+(1.-eta*eta)*jeOverY-2.*eta*f.y)/(2.*q*L)
    -CrOverR*p.z*uCoreDomain.x*pow(q,-.5-uModel.x)*jOverY/2.;
  float rotation=C*pow(q,-1.-uModel.x)*f.w;
  float axial=C*pow(q,-.5-uModel.x)*uCoreDomain.x*f.y+CrOverR*pow(q,D)*f.x;
  return vec3(radial*p.xy+rotation*vec2(-p.y,p.x),axial);
}
// In the pure heat region r,z are invariants. Forward field time can only
// increase Y, so this orbit cannot cross back into the tabulated core.
vec3 heatOrbit(vec3 p,float tauStart,float tauEnd,float delta){
  float r2=dot(p.xy,p.xy);
  float omega=dot(extendedVelocity(p,tauStart).xy,vec2(-p.y,p.x))/r2;
  float meanH=profile(4.*tauStart/r2);
  float factor=omega/meanH;
  if(tauStart!=tauEnd){
    vec4 nodes=vec4(.1834346425,.5255324099,.7966664774,.9602898565);
    vec4 weights=vec4(.3626837834,.3137066459,.2223810345,.1012285363);
    meanH=0.;
    for(int i=0;i<4;i++){
      float a=mix(tauStart,tauEnd,.5-.5*nodes[i]);
      float b=mix(tauStart,tauEnd,.5+.5*nodes[i]);
      meanH+=.5*weights[i]*(profile(4.*a/r2)+profile(4.*b/r2));
    }
  }
  float angle=delta*factor*meanH;
  vec2 turn;
  if(abs(angle)<.1){
    // Some GPU trig approximations lose several ulps near cos(0)=1.
    // These small-angle series have truncation error below 3e-13 here.
    float a2=angle*angle;
    turn=vec2(1.-a2*(.5-a2*(1./24.-a2/720.)),angle*(1.-a2*(1./6.-a2*(1./120.-a2/5040.))));
  }else turn=vec2(cos(angle),sin(angle));
  turn=normalize(turn); // enforce the circular orbit despite GPU trig error
  return vec3(turn.x*p.x-turn.y*p.y,turn.y*p.x+turn.x*p.y,p.z);
}
`;
