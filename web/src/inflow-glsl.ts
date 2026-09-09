type Vector = readonly [number, number, number];

/** Physical inward crossing speed through a translating, dilating sphere. */
export function inwardFlux(
  position: Vector, velocity: Vector, center: Vector,
  observerVelocity: Vector, scaleRate: number, transportRate: number,
  inner: boolean,
) {
  const offset = position.map((value, i) => value - center[i]);
  const radius = Math.hypot(...offset);
  if (!(radius > 0)) return 0;
  const radial = offset.reduce((sum, value, i) =>
    sum + value / radius * (transportRate * velocity[i] - observerVelocity[i]), 0)
    - radius * scaleRate;
  return Math.max(0, inner ? radial : -radial);
}

/**
 * Finite-candidate importance resampling of incoming boundary flux.
 * Area-uniform sphere proposals acquire only their positive crossing speed.
 * This is a sampling approximation; it does not modify tracer velocities.
 *
 * Requires random(seed), velocity(p), shellSupport(), uShip/uScale/uShell,
 * uOpticalShell/uShellFade. A failed proposal leaves the particle slot inactive.
 */
export const INFLOW_GLSL = `
uniform vec3 uObserverVelocity;
uniform float uObserverScaleRate,uTransportRate;
uniform int uInflowCandidates;
float inwardBoundaryFlux(vec3 p,bool inner){
  vec3 offset=p-uShip;float radius=length(offset);
  if(radius<=0.)return 0.;
  float radial=dot(uTransportRate*velocity(p)-uObserverVelocity,offset/radius)
    -radius*uObserverScaleRate;
  return max(0.,inner?radial:-radial);
}
float hiddenInwardFlux(vec3 p){
  float distance=length(p-uShip)/uScale;
  vec2 support=shellSupport(uOpticalShell,uShellFade);
  return inwardBoundaryFlux(p,distance<support.x);
}
bool spawnInflow(inout uint seed,out vec3 selected){
  vec2 support=shellSupport(uOpticalShell,uShellFade);
  float innerArea=support.x>uShell.x?support.x*support.x:0.;
  float outerArea=support.y*support.y;
  float totalWeight=0.;selected=uShip;
  // Uniform area proposals, followed by positive-flux weighted reservoir.
  // The count is a uniform to avoid expensive shader-loop unrolling.
  for(int i=0;i<uInflowCandidates;i++){
    bool inner=random(seed)*(innerArea+outerArea)<innerArea;
    float h=2.*random(seed)-1.,phi=6.28318530718*random(seed);
    vec3 direction=vec3(sqrt(max(0.,1.-h*h))*cos(phi),sqrt(max(0.,1.-h*h))*sin(phi),h);
    // A small guard-side offset guarantees zero birth opacity despite rounding.
    float distance=inner?mix(support.x,uShell.x,.005):mix(support.y,uShell.y,.005);
    vec3 p=uShip+direction*(distance*uScale);
    float weight=inwardBoundaryFlux(p,inner);
    if(weight>0.){
      totalWeight+=weight;
      if(random(seed)*totalWeight<weight)selected=p;
    }
  }
  return totalWeight>0.;
}
`;
