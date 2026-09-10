import type { AppState } from './types';
import type { FieldData } from './field';
import { EXTENDED_GLSL } from './extended-glsl';
import { INFLOW_GLSL } from './inflow-glsl';
import { SHELL_GLSL, shellBounds } from './shell';
import { planTransport, type TransportPlan } from './transport';
import { PARTICLE_PROFILE_GLSL } from './particle-profile';

const MAX_PARTICLES = 120_000;
const MOBILE_BATCH_ITERATIONS = 500_000;
const MOBILE_BATCH_PARTICLES = 4096;
// On phones, the same angular samples are concentrated into fewer pixels.
// Attenuate their light by focal length squared, preserving the established
// desktop exposure and never adding extra brightness on larger displays.
function imageExposureScale(width: number, horizontalFov: number) {
  return Math.min(1, (width / 1280 * Math.tan(65 * Math.PI / 360) / Math.tan(horizontalFov * Math.PI / 360)) ** 2);
}
const LUMA = 'vec3(0.2126,0.7152,0.0722)';
const fullscreen = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;
const fieldGLSL = `
${SHELL_GLSL}
uniform vec3 uShip;
uniform float uScale;
uniform vec2 uOpticalShell;
uniform float uShellFade,uBoundaryBlur;
uniform highp sampler2D uProfile,uSwirl,uHeat;
uniform vec2 uCutoff;
uniform vec4 uDomain;
uniform vec4 uModel; // h, cInfinity, table zMax, table zMin
uniform vec2 uTauRange;
uniform float uTau; // remaining time, computed in float64 before upload
uniform int uCore;
uniform vec3 uCoreDomain; // Lambda, Y max, eta max
vec3 coreCoordinates(vec3 p,float tau){
  float D=.5-uModel.x;
  float qMax=tau/(1.-uCoreDomain.z*uCoreDomain.z);
  if(tau<=0.||abs(p.z)>uCoreDomain.z*pow(qMax,D))return vec3(-1.);
  float q=tau;
  for(int i=0;i<6;i++)q=tau+p.z*p.z*pow(q,2.*uModel.x);
  return vec3(uCoreDomain.x*dot(p.xy,p.xy)/(2.*q),p.z/pow(q,D),q);
}
bool coreValid(vec3 c){return c.z>0.&&c.x<=uCoreDomain.y&&abs(c.y)<=uCoreDomain.z;}
vec4 coreProfile(vec2 point){
  vec2 index=vec2(point.x/uCoreDomain.y,(point.y/uCoreDomain.z+1.)*.5)*vec2(textureSize(uProfile,0)-1);
  ivec2 low=min(ivec2(floor(index)),textureSize(uProfile,0)-2);low=max(low,ivec2(0));
  vec2 f=clamp(index-vec2(low),0.,1.);
  return mix(mix(texelFetch(uProfile,low,0),texelFetch(uProfile,low+ivec2(1,0),0),f.x),
    mix(texelFetch(uProfile,low+ivec2(0,1),0),texelFetch(uProfile,low+ivec2(1,1),0),f.x),f.y);
}
float profile(float z){
  if(uCore==2){
    float index=clamp(z/uModel.z,0.,1.)*float(textureSize(uHeat,0).x-1);
    int i=int(floor(index)),j=min(i+1,textureSize(uHeat,0).x-1);
    return mix(texelFetch(uHeat,ivec2(i,0),0).r,texelFetch(uHeat,ivec2(j,0),0).r,fract(index));
  }
  float index=clamp((z-uModel.w)/(uModel.z-uModel.w),0.,1.)*float(textureSize(uProfile,0).x-1);
  int i=int(floor(index));int j=min(i+1,textureSize(uProfile,0).x-1);
  return mix(texelFetch(uProfile,ivec2(i,0),0).r,texelFetch(uProfile,ivec2(j,0),0).r,fract(index));
}
${EXTENDED_GLSL}
bool validAt(vec3 p,float tau){if(tau<uTauRange.x||tau>uTauRange.y)return false;if(uCore==2)return !any(isnan(p))&&!any(isinf(p));if(uCore==1)return coreValid(coreCoordinates(p,tau));float r=length(p.xy);return r>=uDomain.x&&r<=uDomain.y&&p.z>=uDomain.z&&p.z<=uDomain.w;}
bool valid(vec3 p){return validAt(p,uTau);}
vec3 velocityAt(vec3 p,float tau){
  if(tau<uTauRange.x||tau>uTauRange.y)return vec3(0);
  if(uCore==2)return extendedVelocity(p,tau);
  if(uCore==1){
    vec3 c=coreCoordinates(p,tau);if(!coreValid(c))return vec3(0);
    vec4 f=coreProfile(c.xy);
    float radial=f.z/(2.*c.z),rotation=pow(c.z,-1.-uModel.x)*f.x;
    return vec3(radial*p.xy+rotation*vec2(-p.y,p.x),pow(c.z,-.5-uModel.x)*f.y);
  }
  float r=length(p.xy);if(!validAt(p,tau))return vec3(0);
  float z=4.*tau/(r*r);
  float speed=uModel.y*pow(r*r/2.,-.5-uModel.x)*profile(z);
  return vec3(-p.y,p.x,0)*speed/r;
}
vec3 velocity(vec3 p){return velocityAt(p,uTau);}
// Fade to zero while still INSIDE the available field. The last fraction
// of each boundary layer is an invisible reservoir; no field is extrapolated.
float fieldVisibility(vec3 p){
  if(uCore==2)return valid(p)?1.:0.;
  if(!valid(p))return 0.;
  float margin;
  if(uCore==1){
    vec3 c=coreCoordinates(p,uTau);
    margin=min((1.-c.x/uCoreDomain.y)/.1,(1.-abs(c.y)/uCoreDomain.z)/.1);
  }else{
    float r=length(p.xy);
    margin=min(min(r-uDomain.x,uDomain.y-r)/(.05*(uDomain.y-uDomain.x)),
      min(p.z-uDomain.z,uDomain.w-p.z)/(.05*(uDomain.w-uDomain.z)));
  }
  return shellQuintic((margin-.15)/.85);
}
float spatialVisibility(vec3 p){
  return fieldVisibility(p)*shellOpticalWeights(length(p-uShip)/uScale,uOpticalShell,uShellFade,uBoundaryBlur).x;
}`;
const updateVertex = `#version 300 es
precision highp float;
layout(location=0) in vec4 aParticle;
out vec4 nextParticle;
${fieldGLSL}
uniform vec2 uShell;
uniform float uDelta,uWall,uSeed,uTauStart,uTimeDelta,uGeometricDecay,uFirstWeight;
uniform int uSteps,uReseed,uFill,uNewFrom,uSpawnAttempts;
float random(inout uint seed){seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return float(seed)/4294967295.;}
${INFLOW_GLSL}
vec3 spawn(inout uint seed){
  float h=2.*random(seed)-1.;float phi=6.2831853*random(seed);
  float radius=pow(mix(pow(uShell.x,3.),pow(uShell.y,3.),random(seed)),1./3.)*uScale;
  return uShip+radius*vec3(sqrt(1.-h*h)*cos(phi),sqrt(1.-h*h)*sin(phi),h);
}
vec3 spawnHidden(inout uint seed){
  // Also replenish cropped core boundaries, which can lie inside the shell.
  if(uCore==1&&random(seed)<.5){
    float eta=(2.*random(seed)-1.)*uCoreDomain.z;
    float Y=random(seed)*uCoreDomain.y;
    if(random(seed)<.5)Y=uCoreDomain.y*mix(.99,.999,random(seed));
    else eta=(random(seed)<.5?-1.:1.)*uCoreDomain.z*mix(.99,.999,random(seed));
    float q=uTau/(1.-eta*eta),r=sqrt(2.*q*Y/uCoreDomain.x),phi=6.2831853*random(seed);
    return vec3(r*cos(phi),r*sin(phi),eta*pow(q,.5-uModel.x));
  }
  vec2 support=shellSupport(uOpticalShell,uShellFade);
  float innerVolume=max(0.,pow(support.x,3.)-pow(uShell.x,3.));
  float outerVolume=max(0.,pow(uShell.y,3.)-pow(support.y,3.));
  vec2 band=random(seed)*(innerVolume+outerVolume)<innerVolume?vec2(uShell.x,support.x):vec2(support.y,uShell.y);
  float h=2.*random(seed)-1.,phi=6.2831853*random(seed);
  float r=pow(mix(pow(band.x,3.),pow(band.y,3.),random(seed)),1./3.)*uScale;
  return uShip+r*vec3(sqrt(max(0.,1.-h*h))*cos(phi),sqrt(max(0.,1.-h*h))*sin(phi),h);
}
void main(){
  uint seed=uint(gl_VertexID+1)*747796405u+uint(uSeed)*2891336453u+277803737u;
  vec3 p=aParticle.xyz;float age=aParticle.w;
  // Budget recovery must not remove stationary ambient dust. Explicit resets
  // still refill the observation volume after navigation or time scrubbing.
  bool stationary=uCore==2&&dot(p,p)>=uCutoff.y*uCutoff.y;
  bool reborn=(uReseed==1&&(uFill==1||!stationary))||age<0.||gl_VertexID>=uNewFrom;
  if(!reborn){
    bool heat=uCore==2&&!stationary&&uSteps>0&&extendedCoordinates(p,uTauStart).x>=uCoreDomain.y;
    if(heat)p=heatOrbit(p,uTauStart,uTau,uDelta);
    for(int i=0;i<uSteps&&!stationary&&!heat;i++){
      float decay=exp(-uGeometricDecay*float(i));
      float weight=uFirstWeight*decay;float step=uDelta*weight;
      float t=uGeometricDecay>0.?clamp(uTauStart*decay,uTau,uTauStart):uTauStart-uTimeDelta*float(i)/float(uSteps);
      float midpointTau=max(uTau,t-.5*uTimeDelta*weight);
      if(!validAt(p,t)){reborn=true;break;}
      vec3 v=velocityAt(p,t);vec3 midpoint=p+v*step*.5;
      if(!validAt(midpoint,midpointTau)){reborn=true;break;}p+=velocityAt(midpoint,midpointTau)*step;}
    float d=length(p-uShip)/uScale;
    reborn=reborn||!valid(p)||d<uShell.x||d>uShell.y;
    // Do not let outgoing, invisible guard particles occupy the reservoir
    // indefinitely. Replenishment samples the actual incoming boundary flux.
    bool observerMoves=length(uObserverVelocity)+abs(uObserverScaleRate)>0.;
    if(uCore==2&&(!stationary||observerMoves)&&(abs(uTransportRate)>0.||observerMoves)
      &&spatialVisibility(p)<=0.&&hiddenInwardFlux(p)<=0.)reborn=true;
  }
  if(reborn){
    bool fill=uFill==1||gl_VertexID>=uNewFrom;
    age=-1.;
    if(uCore==2&&!fill){
      // Hidden incoming dust already existed in the surrounding fluid. Its
      // spatial shell fade provides the reveal; a second age fade would dim
      // fast crossings. Temporal fades belong to explicit population resets.
      if(spawnInflow(seed,p)&&valid(p)&&spatialVisibility(p)<=0.)age=10.;
    }else for(int i=0;i<uSpawnAttempts;i++){
        p=fill?spawn(seed):spawnHidden(seed);
        float distance=length(p-uShip)/uScale;
        if(valid(p)&&distance>=uShell.x&&distance<=uShell.y&&(fill||spatialVisibility(p)<=0.)){age=0.;break;}
    }
  }else{age=min(age+uWall,10.);}
  nextParticle=vec4(p,age);
}`;
const emptyFragment = `#version 300 es
precision highp float;out vec4 color;void main(){color=vec4(0);}`;
const drawVertex = `#version 300 es
precision highp float;
layout(location=0) in vec4 aParticle;
${fieldGLSL}
uniform vec4 uOrientation;
${PARTICLE_PROFILE_GLSL}
uniform vec2 uResolution,uShell;
uniform float uFocus,uBlur,uFov,uExposure,uBrightness,uColorMax,uShutter;
uniform int uColor,uSaturation;
out vec2 vOffset;
out vec3 vColor;
out vec2 vSigma;
out vec3 vProfile;
vec3 rotate(vec4 q,vec3 v){return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
void main(){
  vec2 corners[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
  vec3 rel=(aParticle.xyz-uShip)/uScale;
  float d=length(rel);
  vec3 camera=rotate(vec4(-uOrientation.xyz,uOrientation.w),rel);
  vec2 shell=shellOpticalWeights(d,uOpticalShell,uShellFade,uBoundaryBlur);
  float baseSigma=sqrt(1.1*1.1+pow(uBlur*abs(1./max(d,.001)-1./uFocus),2.));
  float sigma=shellGaussianSigma(baseSigma,shell.y,64.);
  vec2 corner=corners[gl_VertexID];
  float tangent=tan(uFov*.5);
  // uFov is horizontal. Keep the same focal scale on both image axes.
  vec2 ndc=camera.xy/max(-camera.z,.0001)/vec2(tangent,tangent*uResolution.y/uResolution.x);
  // A short photographic exposure: project the actual fluid velocity into
  // image pixels. Its second moment stretches a normalized Gaussian along
  // the motion, preserving light instead of adding a decorative glow.
  vec2 motion=vec2(0.);
  if(uShutter>0.&&camera.z<-.001){
    vec3 v=rotate(vec4(-uOrientation.xyz,uOrientation.w),velocity(aParticle.xyz)/uScale);
    motion=(v.xy+camera.xy*v.z/(-camera.z))*(uResolution.x/(2.*tangent*(-camera.z)))*uShutter;
  }
  float traceLength=min(length(motion),36.);
  vec2 direction=length(motion)>.00001?normalize(motion):vec2(1.,0.);
  vSigma=vec2(sqrt(sigma*sigma+traceLength*traceLength/12.),sigma);
  float visibility=shell.x*fieldVisibility(aParticle.xyz);
  float ageFade=smoothstep(0.,.35,aParticle.w);
  // Uniform solid angle projects to cos(theta)^3 samples per pixel area.
  // Convert each angular tracer's light to the image-area measure BEFORE
  // Gaussian normalization. This keeps uniform angular dust exposure uniform.
  // A finite guard includes swollen spots without admitting grazing rays
  // with unbounded projection weights. The final footprint is culled below.
  const float maximumRadius=256.;
  bool visible=camera.z<-.001&&aParticle.w>=0.&&visibility>0.
    &&all(lessThanEqual(abs(ndc),vec2(1.)+2.*maximumRadius*1.415/uResolution));
  float imageAreaWeight=visible?pow(d/max(-camera.z,.001),3.):0.;
  float light=12.*uBrightness*exp2(uExposure)*visibility*ageFade*imageAreaWeight;
  vProfile=particleProfileParameters(light,vSigma);
  float support=sqrt(2.*vProfile.z);
  // Extreme exposures have a bounded raster footprint; any light that cannot
  // fit below white here remains HDR for the overlap-redistribution pass.
  float bounded=min(1.,maximumRadius/(support*max(vSigma.x,vSigma.y)));
  vSigma*=bounded; vProfile.x/=bounded*bounded;
  vOffset=corner*support*vSigma;
  vec2 pixelOffset=direction*vOffset.x+vec2(-direction.y,direction.x)*vOffset.y;
  vec2 extent=support*(abs(direction)*vSigma.x+abs(vec2(-direction.y,direction.x))*vSigma.y);
  visible=visible&&all(lessThanEqual(abs(ndc),vec2(1.)+2.*extent/uResolution));
  gl_Position=visible?vec4(ndc+pixelOffset*2./uResolution,0.,1.):vec4(2.,2.,0.,1.);
  vColor=vec3(1.);
  if(uColor==1){
    float speed=length(velocity(aParticle.xyz));float f=clamp(log(1.+speed)/log(1.+uColorMax),0.,1.);
    vColor=mix(vec3(.12,.4,1.),vec3(1.,.14,.055),f);
    if(uSaturation==1)vColor=mix(vec3(dot(vColor,${LUMA})),vColor,1.-clamp((d-uShell.x)/(uShell.y-uShell.x),0.,1.));
    vColor/=max(dot(vColor,${LUMA}),.001);
  }
  if(vProfile.y>0.)vColor=vec3(1.);
}`;
const drawFragment = `#version 300 es
precision highp float;
${PARTICLE_PROFILE_GLSL}
in vec2 vOffset;in vec3 vColor;in vec2 vSigma;in vec3 vProfile;out vec4 color;
float intensity(vec2 offset){vec2 p=offset/vSigma;return particleProfileIntensity(.5*dot(p,p),vProfile);}
void main(){
  float I;
  if(vProfile.y>0.){
    // Integrate the white ellipse edge over each pixel to avoid jagged small
    // plateaus and keep the discrete brightness integral close to its target.
    vec2 dx=dFdx(vOffset),dy=dFdy(vOffset);
    float radius=length(vOffset/vSigma);
    float pixelRadius=length((abs(dx)+abs(dy))*.5/vSigma);
    if(radius+pixelRadius<=sqrt(2.*vProfile.y)) I=vProfile.x;
    else {
      I=0.;
      for(int y=0;y<4;y++)for(int x=0;x<4;x++){
        I+=intensity(vOffset+dx*((float(x)+.5)/4.-.5)+dy*((float(y)+.5)/4.-.5));
      }
      I/=16.;
    }
  }else I=intensity(vOffset);
  if(I<=0.)discard;
  color=vec4(vColor*I,0.);
}`;
// Extract overflow once, then run a linear multiscale convolution. Thresholding
// between scales would freeze sparse samples into visible dotted-grid halos.
// Source-normalized boundary weights preserve all represented light.
const spreadFragment = `#version 300 es
precision highp float;
uniform sampler2D uInput,uHorizontal,uOriginal;
uniform int uStride,uPass,uExtract,uComposite;
out vec4 color;
float w(int i){return i==0?6.:abs(i)==1?4.:1.;}
float normalizer(int source,int size){float n=0.;for(int k=-2;k<=2;k++){int j=source+k*uStride;if(j>=0&&j<size)n+=w(k);}return n;}
vec3 keep(vec3 c){return c/max(1.,max(c.r,max(c.g,c.b)));}
float excess(vec3 c){return max(0.,dot(c-keep(c),${LUMA}));}
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);ivec2 size=textureSize(uInput,0);float light=0.;
  for(int k=-2;k<=2;k++){
    ivec2 source=p+(uPass==0?ivec2(k*uStride,0):ivec2(0,k*uStride));
    if(any(lessThan(source,ivec2(0)))||any(greaterThanEqual(source,size)))continue;
    float value=uPass==0?(uExtract==1?excess(texelFetch(uInput,source,0).rgb):texelFetch(uInput,source,0).r):texelFetch(uHorizontal,source,0).r;
    light+=value*w(k)/normalizer(uPass==0?source.x:source.y,uPass==0?size.x:size.y);
  }
  color=uComposite==1?vec4(keep(texelFetch(uOriginal,p,0).rgb)+vec3(light),0.):vec4(light,0,0,0);
}`;
const displayFragment = `#version 300 es
precision highp float;uniform sampler2D uInput;out vec4 color;
void main(){vec3 c=clamp(texelFetch(uInput,ivec2(gl_FragCoord.xy),0).rgb,0.,1.);
  vec3 encoded=mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));color=vec4(encoded,1.);}`;
const reduceFragment = `#version 300 es
precision highp float;uniform sampler2D uInput;uniform int uFirst;out vec4 color;
void main(){ivec2 p=ivec2(gl_FragCoord.xy)*2;ivec2 size=textureSize(uInput,0);vec4 sum=vec4(0);
for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 q=p+ivec2(x,y);if(any(greaterThanEqual(q,size)))continue;
vec4 c=texelFetch(uInput,q,0);if(uFirst==1){vec3 k=c.rgb/max(1.,max(c.r,max(c.g,c.b)));c=vec4(dot(c.rgb,${LUMA}),dot(c.rgb-k,${LUMA}),0,0);}sum+=c;}
color=sum*.25;}`;

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };
type BatchAudit = {
  deferred: boolean; totalParticles: number; steps: number;
  batches: number; completedBatches: number; completedParticles: number;
  completedParticleSteps: number; maxBatchParticles: number; maxBatchIterations: number; canceled: boolean;
};
type ParticleFrame = {
  state: AppState; count: number; requested: number; transportDelta: number;
  input: number; output: number; seed: number; batchSize: number;
  cursor: number; submittedCursor: number; fence: WebGLSync | null;
  uniforms(): void; audit: BatchAudit;
};

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private programs: Program[] = [];
  private updateProgram: Program;
  private drawProgram: Program;
  private spreadProgram: Program;
  private displayProgram: Program;
  private reduceProgram: Program;
  private particleBuffers: WebGLBuffer[] = [];
  private updateVAOs: WebGLVertexArrayObject[] = [];
  private drawVAOs: WebGLVertexArrayObject[] = [];
  private emptyVAO: WebGLVertexArrayObject;
  private feedback: WebGLTransformFeedback;
  private profile: WebGLTexture;
  private swirlTexture: WebGLTexture | null = null;
  private heatTexture: WebGLTexture | null = null;
  private targets: Target[] = [];
  private reductions: Target[] = [];
  private index = 0;
  private count = 0;
  private capacity: number;
  private seed = 1;
  private resetPending = true;
  private previousScale = 1;
  private previousPosition: number[];
  private lastAnalysis = 0;
  private lightInput = 0;
  private lightOutput = 0;
  private residualOverflow = 0;
  private transportAudit: (TransportPlan & { reseeded: boolean }) | null = null;
  private pendingFrame: ParticleFrame | null = null;
  private batchAudit: BatchAudit | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private state: AppState, readonly field: FieldData) {
    this.capacity = state.touchControls ? 24_000 : MAX_PARTICLES;
    this.previousPosition = [...state.ship.position];
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL 2 is unavailable. Please use a browser with hardware acceleration enabled.');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This browser cannot render the floating-point light buffers required by the observatory.');
    this.updateProgram = this.program(updateVertex, emptyFragment, ['nextParticle']);
    this.drawProgram = this.program(drawVertex, drawFragment);
    this.spreadProgram = this.program(fullscreen, spreadFragment);
    this.displayProgram = this.program(fullscreen, displayFragment);
    this.reduceProgram = this.program(fullscreen, reduceFragment);
    this.emptyVAO = gl.createVertexArray()!;
    this.feedback = gl.createTransformFeedback()!;
    const initial = new Float32Array(this.capacity * 4);
    for (let i = 0; i < this.capacity; i++) initial[i * 4 + 3] = -1;
    for (let i = 0; i < 2; i++) {
      const buffer = gl.createBuffer()!; this.particleBuffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, initial, gl.DYNAMIC_COPY);
      const vao = gl.createVertexArray()!; this.updateVAOs.push(vao);
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      const drawVAO = gl.createVertexArray()!; this.drawVAOs.push(drawVAO);
      gl.bindVertexArray(drawVAO); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
    }
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.profile = gl.createTexture()!;
    const core = field.manifest.core;
    const width = core ? core.yCount : field.table!.count, height = core ? core.etaCount : 1;
    if (Math.max(width, height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('This GPU cannot hold the scientific lookup texture.');
    gl.bindTexture(gl.TEXTURE_2D, this.profile);
    gl.texImage2D(gl.TEXTURE_2D, 0, core ? gl.RGBA32F : gl.R32F, width, height, 0,
      core ? gl.RGBA : gl.RED, gl.FLOAT, field.core ?? new Float32Array(field.table!.values));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (field.swirl) {
      const makeScalar = (data: Float32Array, width: number, height: number) => {
        const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
      };
      this.swirlTexture = makeScalar(field.swirl, width, height);
      this.heatTexture = makeScalar(new Float32Array(field.table!.values), field.table!.count, 1);
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas); this.resize();
  }

  private program(vertex: string, fragment: string, varyings?: string[]): Program {
    const gl = this.gl;
    const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, i ? fragment : vertex); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`WebGL shader compilation failed: ${message}`);
      }
      return shader;
    });
    const program = gl.createProgram()!; shaders.forEach(s => gl.attachShader(program, s));
    if (varyings) gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program); shaders.forEach(s => gl.deleteShader(s));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL shader linking failed: ${gl.getProgramInfoLog(program)}`);
    const result = { program, uniforms: new Map() }; this.programs.push(result); return result;
  }
  private uniform(p: Program, name: string) {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.program, name));
    return p.uniforms.get(name)!;
  }
  private f(p: Program, name: string, value: number) { this.gl.uniform1f(this.uniform(p, name), value); }
  private i(p: Program, name: string, value: number) { this.gl.uniform1i(this.uniform(p, name), value); }
  private texture(p: Program, name: string, texture: WebGLTexture, unit: number) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); this.i(p, name, unit);
  }
  private target(width: number, height: number, fullPrecision = false): Target {
    const gl = this.gl; const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, fullPrecision ? gl.RGBA32F : gl.RGBA16F, width, height, 0, gl.RGBA, fullPrecision ? gl.FLOAT : gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Floating-point light framebuffer is unsupported.');
    return { texture, framebuffer, width, height };
  }
  private destroyTarget(target: Target) { this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.framebuffer); }
  private resize() {
    // Keep the pending frame's viewport and optical targets intact. A resize
    // notification is picked up at the beginning of the next complete frame.
    if (this.pendingFrame) return;
    let ratio = Math.min(window.devicePixelRatio || 1, 1.5) * this.state.renderScale;
    if (this.state.touchControls) ratio = Math.min(ratio, Math.sqrt(450_000 / Math.max(1, this.canvas.clientWidth * this.canvas.clientHeight)));
    const w = Math.max(2, Math.round(this.canvas.clientWidth * ratio));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width === w && this.canvas.height === h && this.targets.length) return;
    this.canvas.width = w; this.canvas.height = h;
    [...this.targets, ...this.reductions].forEach(t => this.destroyTarget(t));
    this.targets = Array.from({ length: 5 }, () => this.target(w, h));
    this.reductions = []; let x = w; let y = h;
    while (x > 1 || y > 1) { x = Math.ceil(x / 2); y = Math.ceil(y / 2); this.reductions.push(this.target(x, y, true)); }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }
  private common(p: Program, s = this.state) {
    const gl = this.gl; const m = this.field.manifest; const t = this.field.table;
    this.texture(p, 'uProfile', this.profile, 0);
    if (this.swirlTexture) this.texture(p, 'uSwirl', this.swirlTexture, 2);
    if (this.heatTexture) this.texture(p, 'uHeat', this.heatTexture, 3);
    gl.uniform2f(this.uniform(p, 'uCutoff'), m.model.cutoffInner ?? 4, m.model.cutoffOuter ?? 8);
    gl.uniform4f(this.uniform(p, 'uDomain'), m.domain.radialMin, m.domain.radialMax, m.domain.axialMin, m.domain.axialMax);
    gl.uniform4f(this.uniform(p, 'uModel'), m.model.h, m.model.cInfinity, t?.zMax ?? 1, t?.zMin ?? 0);
    gl.uniform2f(this.uniform(p, 'uTauRange'), m.time.singular - m.time.end, m.time.singular - m.time.start);
    this.i(p, 'uCore', this.field.swirl ? 2 : m.core ? 1 : 0);
    gl.uniform3f(this.uniform(p, 'uCoreDomain'), m.model.lambda ?? 1, m.core?.yMax ?? 1, m.core?.etaMax ?? .9);
    gl.uniform3fv(this.uniform(p, 'uShip'), s.ship.position);
    gl.uniform2f(this.uniform(p, 'uOpticalShell'), s.near, s.far);
    this.f(p, 'uShellFade', s.shellFade); this.f(p, 'uBoundaryBlur', s.shellBokeh);
    this.f(p, 'uTau', m.time.singular - s.time); this.f(p, 'uScale', s.ship.scale);
  }
  get hasPendingFrame() { return this.pendingFrame !== null; }
  cancelFrame() {
    if (this.pendingFrame?.fence) this.gl.deleteSync(this.pendingFrame.fence);
    if (this.pendingFrame) this.pendingFrame.audit.canceled = true;
    this.pendingFrame = null;
  }
  reseed() { this.cancelFrame(); this.resetPending = true; }
  /** One startup barrier: shader compilation must not consume the first shot. */
  finishFrame() { this.gl.finish(); }

  render(wallDelta: number, transportDelta: number, timeDelta = 0): boolean {
    if (this.disposed) return false;
    if (this.gl.isContextLost()) { this.cancelFrame(); return false; }
    if (this.pendingFrame) return this.continueFrame();
    this.resize();
    const gl = this.gl, live = this.state;
    // User input, resize notifications and debug audits may run between RAFs.
    // All particles and the displayed image use this one immutable frame pose.
    const s: AppState = { ...live, ship: { ...live.ship,
      position: [...live.ship.position], orientation: [...live.ship.orientation] } };
    const bounds = shellBounds({ near: s.near, far: s.far, transitionWidth: s.shellFade });
    const shellVolume = 4 * Math.PI / 3 * (bounds.guard[1] ** 3 - bounds.guard[0] ** 3);
    const previousCount = this.count;
    const requested = Math.min(MAX_PARTICLES, Math.max(100, Math.round(s.density * shellVolume)));
    const desired = Math.min(this.capacity, requested);
    const change = Math.max(1, Math.ceil(this.capacity * wallDelta));
    const count = previousCount === 0 ? desired : previousCount + Math.max(-change, Math.min(change, desired - previousCount));
    const fill = this.resetPending || s.ship.scale / this.previousScale > 1.3 || s.ship.scale / this.previousScale < .77;
    const observerVelocity = s.ship.position.map((p,i) => fill || wallDelta <= 0 ? 0 : (p-this.previousPosition[i])/wallDelta);
    const observerScaleRate = fill || wallDelta <= 0 ? 0 : Math.log(s.ship.scale/this.previousScale)/wallDelta;
    const transport = planTransport({ isCore: !!this.field.manifest.core,
      tauEnd: this.field.manifest.time.singular - s.time, timeDelta, transportDelta,
      maxSteps: this.field.swirl ? 4096 : 256 });
    if (transport.reseed) live.status = 'Field time advanced · dust reseeded because this interval exceeds the integration budget';
    if (transport.limited) live.status = 'Frozen-field dust speed limited by the integration budget · field time unchanged';
    const reseeded = fill || transport.reseed;
    this.transportAudit = { ...transport, reseeded };
    const seed = this.seed;
    const workSteps = reseeded ? 0 : transport.steps;
    const deferred = s.touchControls && count * workSteps > MOBILE_BATCH_ITERATIONS;
    if (s.touchControls && !reseeded && transport.steps > 128) {
      throw new Error('Unsafe mobile particle interval: advance the viewer in smaller time intervals (at most 128 integration steps per frame).');
    }
    // Round bounded batches to a small group of vertices.
    const batchSize = deferred ? Math.min(MOBILE_BATCH_PARTICLES,
      Math.max(32, 16 * Math.floor(MOBILE_BATCH_ITERATIONS / Math.max(1, workSteps) / 16))) : count;
    const audit: BatchAudit = { deferred, totalParticles: count, steps: workSteps,
      batches: 0, completedBatches: 0, completedParticles: 0, completedParticleSteps: 0,
      maxBatchParticles: 0, maxBatchIterations: 0, canceled: false };
    this.batchAudit = audit;
    const frame: ParticleFrame = { state: s, count, requested, transportDelta,
      input: this.index, output: 1-this.index, seed, batchSize,
      cursor: 0, submittedCursor: 0, fence: null, audit,
      uniforms: () => {
        // Restore unchanged uniforms and textures after any intervening audit;
        // never recompute a seed, transport plan, or observer velocity per batch.
        const p = this.updateProgram; gl.useProgram(p.program); this.common(p, s);
        gl.uniform2f(this.uniform(p, 'uShell'), ...bounds.guard);
        this.i(p, 'uNewFrom', previousCount); this.i(p, 'uSpawnAttempts', 24);
        gl.uniform3fv(this.uniform(p, 'uObserverVelocity'), observerVelocity);
        this.f(p, 'uObserverScaleRate', observerScaleRate);
        this.f(p, 'uTransportRate', wallDelta > 0 ? transport.actualDelta/wallDelta : 0);
        this.i(p, 'uInflowCandidates', 12);
        this.f(p, 'uDelta', transport.actualDelta); this.f(p, 'uWall', wallDelta);
        this.f(p, 'uTauStart', transport.tauStart); this.f(p, 'uTimeDelta', timeDelta);
        this.f(p, 'uGeometricDecay', transport.geometricDecay); this.f(p, 'uFirstWeight', transport.firstWeight);
        this.f(p, 'uSeed', seed); this.i(p, 'uSteps', transport.steps);
        this.i(p, 'uFill', fill ? 1 : 0); this.i(p, 'uReseed', reseeded ? 1 : 0);
      } };
    if (deferred) {
      this.pendingFrame = frame;
      this.submitBatch(frame);
      return false;
    }
    this.submitBatch(frame);
    this.completeBatch(frame);
    this.completeFrame(frame);
    return true;
  }

  private submitBatch(frame: ParticleFrame) {
    const gl = this.gl, start = frame.cursor, count = Math.min(frame.batchSize, frame.count-start);
    frame.uniforms();
    // Keep integration off the default framebuffer while its last image is
    // being presented across RAFs (the canvas need not preserve its buffer).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].framebuffer);
    gl.bindVertexArray(this.updateVAOs[frame.input]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
    // Keep original vertex IDs and write each batch to its own output range.
    if (frame.audit.deferred) gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0,
      this.particleBuffers[frame.output], start * 16, count * 16);
    else gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.particleBuffers[frame.output]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, start, count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    frame.submittedCursor = start + count;
    frame.audit.batches++;
    frame.audit.maxBatchParticles = Math.max(frame.audit.maxBatchParticles, count);
    frame.audit.maxBatchIterations = Math.max(frame.audit.maxBatchIterations, count * frame.audit.steps);
    if (frame.audit.deferred) {
      frame.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (!frame.fence) {
        this.cancelFrame();
        if (!gl.isContextLost()) throw new Error('Could not fence the mobile particle update.');
      }
    }
  }

  private completeBatch(frame: ParticleFrame) {
    frame.cursor = frame.submittedCursor;
    frame.audit.completedBatches++;
    frame.audit.completedParticles = frame.cursor;
    frame.audit.completedParticleSteps = frame.cursor * frame.audit.steps;
  }

  private continueFrame(): boolean {
    const gl = this.gl, frame = this.pendingFrame!;
    if (!frame.fence) { this.cancelFrame(); return false; }
    // Zero timeout: the browser gets its event loop back between every batch.
    // WebGL forbids a new sync from signaling inside the task that created it.
    const result = gl.clientWaitSync(frame.fence, 0, 0);
    if (result === gl.TIMEOUT_EXPIRED) { gl.flush(); return false; }
    if (result === gl.WAIT_FAILED) {
      this.cancelFrame();
      if (gl.isContextLost()) return false;
      throw new Error('Mobile particle update synchronization failed.');
    }
    if (result !== gl.ALREADY_SIGNALED && result !== gl.CONDITION_SATISFIED) {
      this.cancelFrame(); throw new Error('Unexpected particle update synchronization result.');
    }
    gl.deleteSync(frame.fence); frame.fence = null;
    this.completeBatch(frame);
    if (frame.cursor < frame.count) { this.submitBatch(frame); return false; }
    this.pendingFrame = null;
    this.completeFrame(frame);
    return true;
  }

  private completeFrame(frame: ParticleFrame) {
    // Only a complete output becomes the next input. Cancellation can therefore
    // discard a partially written output without advancing any particle twice.
    this.index = frame.output; this.count = frame.count; this.seed = frame.seed + 1;
    this.previousScale = frame.state.ship.scale; this.previousPosition = [...frame.state.ship.position];
    this.resetPending = false; this.state.particleCount = frame.count;
    this.drawFrame(frame);
  }

  private drawFrame(frame: ParticleFrame) {
    const gl = this.gl, s = frame.state;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].framebuffer); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.drawProgram.program); this.common(this.drawProgram, s);
    gl.uniform4fv(this.uniform(this.drawProgram, 'uOrientation'), s.ship.orientation);
    gl.uniform2f(this.uniform(this.drawProgram, 'uResolution'), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniform(this.drawProgram, 'uShell'), s.near, s.far);
    this.f(this.drawProgram, 'uFocus', s.focus); this.f(this.drawProgram, 'uBlur', s.blur);
    this.f(this.drawProgram, 'uFov', s.fov * Math.PI / 180); this.f(this.drawProgram, 'uExposure', s.exposure);
    this.f(this.drawProgram, 'uBrightness', (s.touchControls ? imageExposureScale(this.canvas.width, s.fov) : 1)
      * Math.max(1, frame.requested / this.capacity)
      * (s.densityCompensation ? 500 / Math.max(1, s.density) : 1));
    this.f(this.drawProgram, 'uColorMax', s.maxSpeed); this.i(this.drawProgram, 'uColor', s.colorMode === 'speed' ? 1 : 0);
    const shutter = s.introActive && frame.transportDelta > 0
      ? Math.min(.02 * (this.field.manifest.time.singular-s.time), s.playbackSpeed * .035) : 0;
    this.f(this.drawProgram, 'uShutter', shutter);
    this.i(this.drawProgram, 'uSaturation', s.distanceSaturation ? 1 : 0);
    gl.bindVertexArray(this.drawVAOs[this.index]); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, frame.count); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVAO);
    const output = this.redistribute(this.targets[0]);
    if (performance.now() - this.lastAnalysis > 1500) {
      const input = this.measure(this.targets[0]); const result = this.measure(output);
      this.lightInput = input[0]; this.lightOutput = result[0]; this.residualOverflow = result[1];
      this.state.overflow = result[0] > 0 ? result[1] / result[0] : 0;
      this.lastAnalysis = performance.now();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.displayProgram.program); this.texture(this.displayProgram, 'uInput', output.texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private redistribute(input: Target): Target {
    const gl = this.gl; const p = this.spreadProgram; gl.useProgram(p.program);
    gl.viewport(0, 0, input.width, input.height);
    let current = input;
    // Most overflow settles near its source. Only the remaining excess moves
    // to the wider kernel; every group remains linear internally, avoiding
    // sparse grid peaks while keeping saturated regions compact.
    for (const scales of [[1, 2, 4], [1, 2, 4], [1, 2, 4, 8]]) {
      const original = current;
      const first = original === this.targets[2] ? this.targets[3] : this.targets[2];
      const second = original === this.targets[4] ? this.targets[3] : this.targets[4];
      this.texture(p, 'uOriginal', original.texture, 2);
      for (const stride of scales) {
        const output = current === first ? second : first;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[1].framebuffer);
        this.texture(p, 'uInput', current.texture, 0);
        // Both samplers must avoid the render attachment, even when a branch does not sample one.
        this.texture(p, 'uHorizontal', current.texture, 1);
        this.i(p, 'uExtract', stride === 1 ? 1 : 0); this.i(p, 'uComposite', 0);
        this.i(p, 'uStride', stride); this.i(p, 'uPass', 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
        this.texture(p, 'uHorizontal', this.targets[1].texture, 1); this.i(p, 'uPass', 1);
        this.i(p, 'uComposite', stride === scales[scales.length-1] ? 1 : 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        current = output;
      }
    }
    return current;
  }
  private measure(input: Target): Float32Array {
    const gl = this.gl; const p = this.reduceProgram;
    gl.useProgram(p.program); gl.bindVertexArray(this.emptyVAO);
    let current = input;
    for (let i = 0; i < this.reductions.length; i++) {
      const target = this.reductions[i]; gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, target.width, target.height);
      this.texture(p, 'uInput', current.texture, 0); this.i(p, 'uFirst', i === 0 ? 1 : 0); gl.drawArrays(gl.TRIANGLES, 0, 3); current = target;
    }
    const result = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, result);
    const factor = 4 ** this.reductions.length;
    result[0] *= factor; result[1] *= factor;
    return result;
  }

  audit(sampleLimit = 128) {
    const limit = Number.isFinite(sampleLimit) ? Math.max(0, Math.min(MAX_PARTICLES, Math.floor(sampleLimit))) : 128;
    const gl = this.gl; const particles = new Float32Array(Math.min(this.count, limit) * 4);
    gl.bindBuffer(gl.COPY_READ_BUFFER, this.particleBuffers[this.index]); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, particles); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    return { transport: this.transportAudit, batching: this.batchAudit ? { ...this.batchAudit,
      pending: this.hasPendingFrame, cursor: this.pendingFrame?.cursor ?? this.batchAudit.completedParticles,
      submittedCursor: this.pendingFrame?.submittedCursor ?? this.batchAudit.completedParticles } : null,
      lightMeasuredAt: this.lastAnalysis, glError: gl.getError(), finiteParticles: [...particles].every(Number.isFinite), particleSamples: [...particles],
      lightInput: this.lightInput, lightOutput: this.lightOutput, residualOverflow: this.residualOverflow };
  }

  /** Sample the same GLSL field used by particle transport for reference tests. */
  auditVelocity(position: number[], time: number) {
    const gl = this.gl;
    const program = this.program(`#version 300 es\nprecision highp float;
      layout(location=0) in vec3 position;out vec4 sampled;
      ${fieldGLSL}
      void main(){sampled=vec4(velocity(position),valid(position)?1.:0.);}`, emptyFragment, ['sampled']);
    const input = gl.createBuffer()!; const output = gl.createBuffer()!; const vao = gl.createVertexArray()!;
    try {
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(position), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, output); gl.bufferData(gl.ARRAY_BUFFER, 16, gl.STREAM_READ);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(program.program); this.common(program); this.f(program, 'uTau', this.field.manifest.time.singular - time);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
      gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, 1); gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      const result = new Float32Array(4); gl.bindBuffer(gl.COPY_READ_BUFFER, output); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, result); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      return { velocity: [...result.slice(0, 3)], valid: result[3] === 1, glError: gl.getError() };
    } finally {
      gl.deleteBuffer(input); gl.deleteBuffer(output); gl.deleteVertexArray(vao); gl.deleteProgram(program.program);
      this.programs = this.programs.filter(p => p !== program);
    }
  }

  /** Force ordinary particle retirement and measure the real GPU birth opacity. */
  auditShellRecycling() {
    const gl = this.gl, count = 128;
    const input = gl.createBuffer()!, output = gl.createBuffer()!, measured = gl.createBuffer()!;
    const vao = gl.createVertexArray()!, outputVAO = gl.createVertexArray()!;
    const probe = this.program(`#version 300 es\nprecision highp float;
      layout(location=0) in vec4 particle;out vec2 result;
      ${fieldGLSL}
      void main(){result=vec2(spatialVisibility(particle.xyz),particle.w);}`, emptyFragment, ['result']);
    try {
      const data = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) { data[i * 4] = 1e4; data[i * 4 + 3] = 10; }
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, output); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.STREAM_READ);
      gl.bindVertexArray(outputVAO); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, measured); gl.bufferData(gl.ARRAY_BUFFER, count * 8, gl.STREAM_READ);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const p = this.updateProgram; gl.useProgram(p.program); this.common(p);
      const s = this.state, bounds = shellBounds({ near: s.near, far: s.far, transitionWidth: s.shellFade });
      gl.uniform2f(this.uniform(p, 'uShell'), ...bounds.guard);
      this.i(p, 'uSteps', 0); this.i(p, 'uReseed', 0); this.i(p, 'uFill', 0); this.i(p, 'uNewFrom', count); this.i(p, 'uSpawnAttempts', 24);
      gl.uniform3f(this.uniform(p, 'uObserverVelocity'), 0, 0, 0);
      this.f(p, 'uObserverScaleRate', 0); this.f(p, 'uTransportRate', 1); this.i(p, 'uInflowCandidates', 12);
      this.f(p, 'uWall', .016); this.f(p, 'uSeed', 43);
      gl.bindVertexArray(vao); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output); gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, count); gl.endTransformFeedback();
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.useProgram(probe.program); this.common(probe); gl.bindVertexArray(outputVAO);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, measured);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, count); gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      const values = new Float32Array(count * 2);
      gl.bindBuffer(gl.COPY_READ_BUFFER, measured); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, values); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      const births = Array.from({ length: count }, (_, i) => ({ opacity: values[i * 2], age: values[i * 2 + 1] })).filter(x => x.age === 0 || x.age === 10);
      return { births: births.length, maximumBirthOpacity: Math.max(0, ...births.map(x => x.opacity)),
        finite: [...values].every(Number.isFinite), glError: gl.getError() };
    } finally {
      gl.deleteBuffer(input); gl.deleteBuffer(output); gl.deleteBuffer(measured); gl.deleteVertexArray(vao); gl.deleteVertexArray(outputVAO);
      gl.deleteProgram(probe.program); this.programs = this.programs.filter(p => p !== probe);
    }
  }

  /** Small synthetic GPU scenes exercise the actual redistribution shaders. */
  auditLight(halo = false) {
    const gl = this.gl;
    const savedTargets = this.targets; const savedReductions = this.reductions;
    const size = halo ? 256 : 64;
    this.targets = Array.from({ length: 5 }, () => this.target(size, size));
    this.reductions = (halo ? [128, 64, 32, 16, 8, 4, 2, 1] : [32, 16, 8, 4, 2, 1]).map(n => this.target(n, n, true));
    const cases: { name: string; input: number; output: number; overflow: number; relativeError: number; row?: number[]; pixels?: number[] }[] = [];
    try {
      for (const name of (halo ? ['bright-gaussian', 'dim-gaussian'] : ['center', 'edge', 'color', 'full-screen'])) {
        const data = new Float32Array(size * size * 4);
        if (halo) {
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const value = (name === 'bright-gaussian' ? 20 : .5) * Math.exp(-((x-size/2)**2+(y-size/2)**2)/4.5);
            data.set([value, value, value, 0], (y*size+x)*4);
          }
        } else if (name === 'full-screen') {
          for (let i = 0; i < size * size; i++) data.set([2, 2, 2, 0], i * 4);
        } else {
          const pixel = name === 'edge' ? 0 : (size / 2) * size + size / 2;
          data.set(name === 'color' ? [64, 4, 0, 0] : [64, 64, 64, 0], pixel * 4);
        }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.FLOAT, data);
        gl.disable(gl.BLEND); gl.bindVertexArray(this.emptyVAO);
        const input = this.measure(this.targets[0]);
        const image = this.redistribute(this.targets[0]);
        let row: number[] | undefined, pixels: number[] | undefined;
        if (halo) {
          const values = new Float32Array(size * size * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, image.framebuffer);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, values);
          row = Array.from({ length: 65 }, (_, x) => values[((size/2)*size+size/2+x)*4]);
          pixels = Array.from({ length: size*size }, (_, index) => values[index*4]);
        }
        const output = this.measure(image);
        cases.push({ name, input: input[0], output: output[0], overflow: output[1], relativeError: Math.abs(output[0] - input[0]) / input[0], row, pixels });
      }
      return { cases, size, glError: gl.getError() };
    } finally {
      [...this.targets, ...this.reductions].forEach(t => this.destroyTarget(t));
      this.targets = savedTargets; this.reductions = savedReductions;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /** Verify the rendered Gaussian footprint, not just its analytic formula. */
  auditGaussian(shutter = 0, useCurrentOptics = false, exposure = 0) {
    const gl = this.gl; const savedReductions = this.reductions;
    const size = useCurrentOptics || exposure > 0 ? 256 : 64;
    const target = this.target(size, size);
    this.reductions = (size === 256 ? [128, 64, 32, 16, 8, 4, 2, 1] : [32, 16, 8, 4, 2, 1]).map(n => this.target(n, n, true));
    const buffer = gl.createBuffer()!; const vao = gl.createVertexArray()!;
    const cases: { distance: number; light: number; rmsRadius: number; peak: number; whitePixels: number; xVariance: number; yVariance: number }[] = [];
    try {
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
      for (const distance of (useCurrentOptics ? [2, 3, 4.5] : [1.2, 2, 2.8])) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([2, 0, -distance, 10]), gl.STREAM_DRAW);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, size, size);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const p = this.drawProgram; gl.useProgram(p.program); this.common(p);
        gl.uniform3f(this.uniform(p, 'uShip'), 2, 0, 0); gl.uniform4f(this.uniform(p, 'uOrientation'), 0, 0, 0, 1);
        gl.uniform2f(this.uniform(p, 'uResolution'), size, size); gl.uniform2f(this.uniform(p, 'uShell'), 1, 3);
        if (!useCurrentOptics) gl.uniform2f(this.uniform(p, 'uOpticalShell'), 1, 3);
        this.f(p, 'uScale', 1); this.f(p, 'uFocus', useCurrentOptics ? this.state.focus : 2);
        this.f(p, 'uBlur', useCurrentOptics ? this.state.blur : 8); this.f(p, 'uFov', 1);
        this.f(p, 'uExposure', exposure); this.f(p, 'uBrightness', 1); this.i(p, 'uColor', 0);
        this.f(p, 'uShutter', shutter);
        gl.disable(gl.BLEND); gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
        const pixels = new Float32Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, pixels);
        let energy = 0, moment = 0, xMoment = 0, yMoment = 0, peak = 0, whitePixels = 0;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const light = pixels[(y * size + x) * 4];
          energy += light; moment += light * ((x + .5 - size / 2) ** 2 + (y + .5 - size / 2) ** 2);
          xMoment += light * (x + .5 - size / 2) ** 2; yMoment += light * (y + .5 - size / 2) ** 2;
          peak = Math.max(peak, light); if (light >= .999) whitePixels++;
        }
        cases.push({ distance, light: this.measure(target)[0], rmsRadius: Math.sqrt(moment / energy), peak, whitePixels,
          xVariance: xMoment / energy, yVariance: yMoment / energy });
      }
      return { cases, expectedLight: 12 * 2 ** exposure, glError: gl.getError() };
    } finally {
      gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); this.destroyTarget(target);
      this.reductions.forEach(t => this.destroyTarget(t)); this.reductions = savedReductions;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /** Isolate the camera response with a fixed, isotropic, valid-domain shell. */
  auditProjection(width = 320, height = 240) {
    const gl = this.gl; const count = 80_000;
    const target = this.target(width, height);
    const buffer = gl.createBuffer()!; const vao = gl.createVertexArray()!;
    const particles = new Float32Array(count * 4);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const z = 1 - 2 * (i + .5) / count;
      const r = Math.sqrt(1 - z * z); const theta = i * goldenAngle;
      // Ship [4,0,0], scale .5, shell radius 2: all samples are valid.
      particles.set([4 + r * Math.cos(theta), r * Math.sin(theta), z, 10], i * 4);
    }
    const orientations = [
      { name: 'forward', q: [0, 0, 0, 1] },
      { name: 'yaw90', q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
      { name: 'tilted', q: [.25, -.4, .1, .875].map(x => x / Math.hypot(.25, -.4, .1, .875)) },
    ];
    const regions = [
      ['center', 0, 0], ['left', -.65, 0], ['right', .65, 0],
      ['top', 0, .65], ['bottom', 0, -.65],
      ['upper-left', -.55, .55], ['lower-right', .55, -.55],
    ] as const;
    const cases = [];
    try {
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
      for (const fov of [65, 100]) for (const orientation of orientations) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const p = this.drawProgram; gl.useProgram(p.program); this.common(p);
        gl.uniform3f(this.uniform(p, 'uShip'), 4, 0, 0); gl.uniform4fv(this.uniform(p, 'uOrientation'), orientation.q);
        gl.uniform2f(this.uniform(p, 'uResolution'), width, height); gl.uniform2f(this.uniform(p, 'uShell'), 1, 3);
        gl.uniform2f(this.uniform(p, 'uOpticalShell'), 1, 3);
        this.f(p, 'uScale', .5); this.f(p, 'uFocus', 1); this.f(p, 'uBlur', 6);
        this.f(p, 'uFov', fov * Math.PI / 180); this.f(p, 'uExposure', -6);
        this.f(p, 'uBrightness', imageExposureScale(width, fov)); this.i(p, 'uColor', 0);
        this.f(p, 'uShutter', 0);
        gl.bindVertexArray(vao); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count); gl.disable(gl.BLEND);
        const pixels = new Float32Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
        const measured = regions.map(([name, x, y]) => {
          const cx = Math.round((x + 1) * width / 2); const cy = Math.round((y + 1) * height / 2);
          let sum = 0;
          for (let row = cy - 12; row < cy + 12; row++) for (let col = cx - 12; col < cx + 12; col++) {
            const i = (row * width + col) * 4;
            sum += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
          }
          return { name, mean: sum / (24 * 24) };
        });
        const outer = measured.slice(1).reduce((sum, r) => sum + r.mean, 0) / (measured.length - 1);
        cases.push({ orientation: orientation.name, fov, regions: measured,
          centerToOuter: measured[0].mean / outer,
          maxToMin: Math.max(...measured.map(r => r.mean)) / Math.min(...measured.map(r => r.mean)) });
      }
      return { cases, glError: gl.getError() };
    } finally {
      gl.disable(gl.BLEND); gl.deleteBuffer(buffer); gl.deleteVertexArray(vao);
      this.destroyTarget(target); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }
  dispose() {
    if (this.disposed) return; this.cancelFrame(); this.disposed = true; this.resizeObserver.disconnect(); const gl = this.gl;
    [...this.targets, ...this.reductions].forEach(t => this.destroyTarget(t));
    this.programs.forEach(p => gl.deleteProgram(p.program)); this.particleBuffers.forEach(b => gl.deleteBuffer(b));
    [...this.updateVAOs, ...this.drawVAOs, this.emptyVAO].forEach(v => gl.deleteVertexArray(v));
    gl.deleteTransformFeedback(this.feedback); gl.deleteTexture(this.profile); if (this.swirlTexture) gl.deleteTexture(this.swirlTexture); if (this.heatTexture) gl.deleteTexture(this.heatTexture);
  }
}
