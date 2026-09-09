import type { AppState } from './types';
import type { FieldData } from './field';
import { planTransport, type TransportPlan } from './transport';

const MAX_PARTICLES = 120_000;
const LUMA = 'vec3(0.2126,0.7152,0.0722)';
const fullscreen = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;
const fieldGLSL = `
uniform sampler2D uProfile;
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
  float index=clamp((z-uModel.w)/(uModel.z-uModel.w),0.,1.)*float(textureSize(uProfile,0).x-1);
  int i=int(floor(index));int j=min(i+1,textureSize(uProfile,0).x-1);
  return mix(texelFetch(uProfile,ivec2(i,0),0).r,texelFetch(uProfile,ivec2(j,0),0).r,fract(index));
}
bool validAt(vec3 p,float tau){if(tau<uTauRange.x||tau>uTauRange.y)return false;if(uCore==1)return coreValid(coreCoordinates(p,tau));float r=length(p.xy);return r>=uDomain.x&&r<=uDomain.y&&p.z>=uDomain.z&&p.z<=uDomain.w;}
bool valid(vec3 p){return validAt(p,uTau);}
vec3 velocityAt(vec3 p,float tau){
  if(tau<uTauRange.x||tau>uTauRange.y)return vec3(0);
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
vec3 velocity(vec3 p){return velocityAt(p,uTau);}`;
const updateVertex = `#version 300 es
precision highp float;
layout(location=0) in vec4 aParticle;
out vec4 nextParticle;
${fieldGLSL}
uniform vec3 uShip;
uniform vec2 uShell;
uniform float uScale,uDelta,uWall,uSeed,uTauStart,uTimeDelta,uGeometricDecay,uFirstWeight;
uniform int uSteps,uReseed;
float random(inout uint seed){seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return float(seed)/4294967295.;}
vec3 spawn(inout uint seed){
  float h=2.*random(seed)-1.;float phi=6.2831853*random(seed);
  float radius=pow(mix(pow(uShell.x,3.),pow(uShell.y,3.),random(seed)),1./3.)*uScale;
  return uShip+radius*vec3(sqrt(1.-h*h)*cos(phi),sqrt(1.-h*h)*sin(phi),h);
}
void main(){
  uint seed=uint(gl_VertexID+1)*747796405u+uint(uSeed)*2891336453u+277803737u;
  vec3 p=aParticle.xyz;float age=aParticle.w;
  bool reborn=uReseed==1||age<0.;
  if(!reborn){
    for(int i=0;i<uSteps;i++){
      float decay=exp(-uGeometricDecay*float(i));
      float weight=uFirstWeight*decay;float step=uDelta*weight;
      float t=uGeometricDecay>0.?clamp(uTauStart*decay,uTau,uTauStart):uTauStart-uTimeDelta*float(i)/float(uSteps);
      float midpointTau=max(uTau,t-.5*uTimeDelta*weight);
      if(!validAt(p,t)){reborn=true;break;}
      vec3 v=velocityAt(p,t);vec3 midpoint=p+v*step*.5;
      if(!validAt(midpoint,midpointTau)){reborn=true;break;}p+=velocityAt(midpoint,midpointTau)*step;}
    float d=length(p-uShip)/uScale;
    reborn=reborn||!valid(p)||d<uShell.x||d>uShell.y;
  }
  if(reborn){
    age=-1.;for(int i=0;i<24;i++){p=spawn(seed);if(valid(p)){age=0.;break;}}
  }else{age=min(age+uWall,10.);}
  nextParticle=vec4(p,age);
}`;
const emptyFragment = `#version 300 es
precision highp float;out vec4 color;void main(){color=vec4(0);}`;
const drawVertex = `#version 300 es
precision highp float;
layout(location=0) in vec4 aParticle;
${fieldGLSL}
uniform vec3 uShip;
uniform vec4 uOrientation;
uniform vec2 uResolution,uShell;
uniform float uScale,uFocus,uBlur,uFov,uExposure,uBrightness,uColorMax;
uniform int uColor,uSaturation;
out vec2 vOffset;
out vec3 vColor;
out float vSigma,vLight;
vec3 rotate(vec4 q,vec3 v){return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
void main(){
  vec2 corners[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
  vec3 rel=(aParticle.xyz-uShip)/uScale;
  float d=length(rel);
  vec3 camera=rotate(vec4(-uOrientation.xyz,uOrientation.w),rel);
  float sigma=sqrt(1.1*1.1+pow(uBlur*abs(1./max(d,.001)-1./uFocus),2.));
  sigma=min(sigma,64.);vSigma=sigma;
  vec2 corner=corners[gl_VertexID];vOffset=corner*3.*sigma;
  float tangent=tan(uFov*.5);
  // uFov is horizontal. Keep the same focal scale on both image axes.
  vec2 ndc=camera.xy/max(-camera.z,.0001)/vec2(tangent,tangent*uResolution.y/uResolution.x);
  gl_Position=vec4(ndc+vOffset*2./uResolution,0.,1.);
  float feather=min(.15,(uShell.y-uShell.x)*.15);
  float visibility=smoothstep(uShell.x,uShell.x+feather,d)*(1.-smoothstep(uShell.y-feather,uShell.y,d));
  float ageFade=smoothstep(0.,.35,aParticle.w);
  // Uniform solid angle projects to cos(theta)^3 samples per pixel area.
  // Convert each angular tracer's light to the image-area measure BEFORE
  // Gaussian normalization. This keeps uniform angular dust exposure uniform.
  // Cull the complete footprint first: grazing, offscreen rays must not create
  // unbounded weights. The viewport plus its Gaussian guard band bounds gain.
  bool visible=camera.z<-.001&&aParticle.w>=0.&&valid(aParticle.xyz)
    &&all(lessThanEqual(abs(ndc),vec2(1.)+6.*sigma/uResolution));
  float imageAreaWeight=visible?pow(d/max(-camera.z,.001),3.):0.;
  vLight=12.*uBrightness*exp2(uExposure)*visibility*ageFade*imageAreaWeight;
  if(!visible){vLight=0.;gl_Position=vec4(2.,2.,0.,1.);}
  vColor=vec3(1.);
  if(uColor==1){
    float speed=length(velocity(aParticle.xyz));float f=clamp(log(1.+speed)/log(1.+uColorMax),0.,1.);
    vColor=mix(vec3(.12,.4,1.),vec3(1.,.14,.055),f);
    if(uSaturation==1)vColor=mix(vec3(dot(vColor,${LUMA})),vColor,1.-clamp((d-uShell.x)/(uShell.y-uShell.x),0.,1.));
    vColor/=max(dot(vColor,${LUMA}),.001);
  }
}`;
const drawFragment = `#version 300 es
precision highp float;
in vec2 vOffset;in vec3 vColor;in float vSigma,vLight;out vec4 color;
void main(){float r2=dot(vOffset,vOffset)/(vSigma*vSigma);if(r2>9.)discard;
  float I=vLight*exp(-.5*r2)/(6.28318530718*vSigma*vSigma*(1.-exp(-4.5)));
  color=vec4(vColor*I,0.);
}`;
// Gather weights are normalized at their source, so truncated boundary kernels
// distribute all source light. The two separable passes conserve linear luminance.
const spreadFragment = `#version 300 es
precision highp float;
uniform sampler2D uInput,uHorizontal;
uniform int uStride,uPass;
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
    float value=uPass==0?excess(texelFetch(uInput,source,0).rgb):texelFetch(uHorizontal,source,0).r;
    light+=value*w(k)/normalizer(uPass==0?source.x:source.y,uPass==0?size.x:size.y);
  }
  color=uPass==0?vec4(light,0,0,0):vec4(keep(texelFetch(uInput,p,0).rgb)+vec3(light),0.);
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
  private targets: Target[] = [];
  private reductions: Target[] = [];
  private index = 0;
  private count = 0;
  private seed = 1;
  private resetPending = true;
  private previousScale = 1;
  private lastAnalysis = 0;
  private lightInput = 0;
  private lightOutput = 0;
  private residualOverflow = 0;
  private transportAudit: (TransportPlan & { reseeded: boolean }) | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private state: AppState, readonly field: FieldData) {
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
    const initial = new Float32Array(MAX_PARTICLES * 4);
    for (let i = 0; i < MAX_PARTICLES; i++) initial[i * 4 + 3] = -1;
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
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5) * this.state.renderScale;
    const w = Math.max(2, Math.round(this.canvas.clientWidth * ratio));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width === w && this.canvas.height === h && this.targets.length) return;
    this.canvas.width = w; this.canvas.height = h;
    [...this.targets, ...this.reductions].forEach(t => this.destroyTarget(t));
    this.targets = Array.from({ length: 4 }, () => this.target(w, h));
    this.reductions = []; let x = w; let y = h;
    while (x > 1 || y > 1) { x = Math.ceil(x / 2); y = Math.ceil(y / 2); this.reductions.push(this.target(x, y, true)); }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }
  private common(p: Program) {
    const gl = this.gl; const s = this.state; const m = this.field.manifest; const t = this.field.table;
    this.texture(p, 'uProfile', this.profile, 0);
    gl.uniform4f(this.uniform(p, 'uDomain'), m.domain.radialMin, m.domain.radialMax, m.domain.axialMin, m.domain.axialMax);
    gl.uniform4f(this.uniform(p, 'uModel'), m.model.h, m.model.cInfinity, t?.zMax ?? 1, t?.zMin ?? 0);
    gl.uniform2f(this.uniform(p, 'uTauRange'), m.time.singular - m.time.end, m.time.singular - m.time.start);
    this.i(p, 'uCore', m.core ? 1 : 0);
    gl.uniform3f(this.uniform(p, 'uCoreDomain'), m.model.lambda ?? 1, m.core?.yMax ?? 1, m.core?.etaMax ?? .9);
    gl.uniform3fv(this.uniform(p, 'uShip'), s.ship.position);
    this.f(p, 'uTau', m.time.singular - s.time); this.f(p, 'uScale', s.ship.scale);
  }
  reseed() { this.resetPending = true; }

  render(wallDelta: number, transportDelta: number, timeDelta = 0): void {
    if (this.disposed) return;
    this.resize(); const gl = this.gl; const s = this.state;
    const shellVolume = 4 * Math.PI / 3 * (s.far ** 3 - s.near ** 3);
    const desired = Math.min(MAX_PARTICLES, Math.max(100, Math.round(s.density * shellVolume)));
    const change = Math.max(1, Math.ceil(MAX_PARTICLES * wallDelta));
    this.count = this.count === 0 ? desired : this.count + Math.max(-change, Math.min(change, desired - this.count));
    s.particleCount = this.count;
    if (s.ship.scale / this.previousScale > 1.3 || s.ship.scale / this.previousScale < .77) this.resetPending = true;
    this.previousScale = s.ship.scale;
    const transport = planTransport({ isCore: !!this.field.manifest.core,
      tauEnd: this.field.manifest.time.singular - s.time, timeDelta, transportDelta });
    if (transport.reseed) s.status = 'Field time advanced · dust reseeded because this interval exceeds the integration budget';
    if (transport.limited) s.status = 'Frozen-field dust speed limited by the integration budget · field time unchanged';
    this.transportAudit = { ...transport, reseeded: this.resetPending || transport.reseed };
    const next = 1 - this.index;
    gl.useProgram(this.updateProgram.program); this.common(this.updateProgram);
    gl.uniform2f(this.uniform(this.updateProgram, 'uShell'), Math.max(.001, s.near * .8), s.far * 1.1);
    this.f(this.updateProgram, 'uDelta', transport.actualDelta); this.f(this.updateProgram, 'uWall', wallDelta);
    this.f(this.updateProgram, 'uTauStart', transport.tauStart); this.f(this.updateProgram, 'uTimeDelta', timeDelta);
    this.f(this.updateProgram, 'uGeometricDecay', transport.geometricDecay); this.f(this.updateProgram, 'uFirstWeight', transport.firstWeight);
    this.f(this.updateProgram, 'uSeed', this.seed++); this.i(this.updateProgram, 'uSteps', transport.steps);
    this.i(this.updateProgram, 'uReseed', this.transportAudit.reseeded ? 1 : 0); this.resetPending = false;
    gl.bindVertexArray(this.updateVAOs[this.index]); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.particleBuffers[next]);
    gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, this.count); gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    this.index = next;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].framebuffer); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.drawProgram.program); this.common(this.drawProgram);
    gl.uniform4fv(this.uniform(this.drawProgram, 'uOrientation'), s.ship.orientation);
    gl.uniform2f(this.uniform(this.drawProgram, 'uResolution'), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniform(this.drawProgram, 'uShell'), s.near, s.far);
    this.f(this.drawProgram, 'uFocus', s.focus); this.f(this.drawProgram, 'uBlur', s.blur);
    this.f(this.drawProgram, 'uFov', s.fov * Math.PI / 180); this.f(this.drawProgram, 'uExposure', s.exposure);
    this.f(this.drawProgram, 'uBrightness', s.densityCompensation ? 500 / Math.max(1, s.density) : 1);
    this.f(this.drawProgram, 'uColorMax', s.maxSpeed); this.i(this.drawProgram, 'uColor', s.colorMode === 'speed' ? 1 : 0);
    this.i(this.drawProgram, 'uSaturation', s.distanceSaturation ? 1 : 0);
    gl.bindVertexArray(this.drawVAOs[this.index]); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVAO);
    const output = this.redistribute(this.targets[0]);
    if (performance.now() - this.lastAnalysis > 1500) {
      const input = this.measure(this.targets[0]); const result = this.measure(output);
      this.lightInput = input[0]; this.lightOutput = result[0]; this.residualOverflow = result[1];
      s.overflow = result[0] > 0 ? result[1] / result[0] : 0;
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
    for (const stride of [1, 2, 4, 8, 16]) {
      const output = current === this.targets[2] ? this.targets[3] : this.targets[2];
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[1].framebuffer);
      this.texture(p, 'uInput', current.texture, 0);
      // Both samplers must avoid the render attachment, even when a branch does not sample one.
      this.texture(p, 'uHorizontal', current.texture, 1);
      this.i(p, 'uStride', stride); this.i(p, 'uPass', 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
      this.texture(p, 'uHorizontal', this.targets[1].texture, 1); this.i(p, 'uPass', 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      current = output;
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

  audit() {
    const gl = this.gl; const particles = new Float32Array(Math.min(this.count, 128) * 4);
    gl.bindBuffer(gl.COPY_READ_BUFFER, this.particleBuffers[this.index]); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, particles); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    return { transport: this.transportAudit, lightMeasuredAt: this.lastAnalysis, glError: gl.getError(), finiteParticles: [...particles].every(Number.isFinite), particleSamples: [...particles],
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

  /** Small synthetic GPU scenes exercise the actual redistribution shaders. */
  auditLight() {
    const gl = this.gl;
    const savedTargets = this.targets; const savedReductions = this.reductions;
    const size = 64;
    this.targets = Array.from({ length: 4 }, () => this.target(size, size));
    this.reductions = [32, 16, 8, 4, 2, 1].map(n => this.target(n, n, true));
    const cases: { name: string; input: number; output: number; overflow: number; relativeError: number }[] = [];
    try {
      for (const name of ['center', 'edge', 'color', 'full-screen']) {
        const data = new Float32Array(size * size * 4);
        if (name === 'full-screen') {
          for (let i = 0; i < size * size; i++) data.set([2, 2, 2, 0], i * 4);
        } else {
          const pixel = name === 'edge' ? 0 : (size / 2) * size + size / 2;
          data.set(name === 'color' ? [64, 4, 0, 0] : [64, 64, 64, 0], pixel * 4);
        }
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.FLOAT, data);
        gl.disable(gl.BLEND); gl.bindVertexArray(this.emptyVAO);
        const input = this.measure(this.targets[0]);
        const output = this.measure(this.redistribute(this.targets[0]));
        cases.push({ name, input: input[0], output: output[0], overflow: output[1], relativeError: Math.abs(output[0] - input[0]) / input[0] });
      }
      return { cases, glError: gl.getError() };
    } finally {
      [...this.targets, ...this.reductions].forEach(t => this.destroyTarget(t));
      this.targets = savedTargets; this.reductions = savedReductions;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /** Verify the rendered Gaussian footprint, not just its analytic formula. */
  auditGaussian() {
    const gl = this.gl; const savedReductions = this.reductions;
    const target = this.target(64, 64);
    this.reductions = [32, 16, 8, 4, 2, 1].map(n => this.target(n, n, true));
    const buffer = gl.createBuffer()!; const vao = gl.createVertexArray()!;
    const cases: { distance: number; light: number }[] = [];
    try {
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
      for (const distance of [1.2, 2, 2.8]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([2, 0, -distance, 10]), gl.STREAM_DRAW);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0, 0, 64, 64);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const p = this.drawProgram; gl.useProgram(p.program); this.common(p);
        gl.uniform3f(this.uniform(p, 'uShip'), 2, 0, 0); gl.uniform4f(this.uniform(p, 'uOrientation'), 0, 0, 0, 1);
        gl.uniform2f(this.uniform(p, 'uResolution'), 64, 64); gl.uniform2f(this.uniform(p, 'uShell'), 1, 3);
        this.f(p, 'uScale', 1); this.f(p, 'uFocus', 2); this.f(p, 'uBlur', 8); this.f(p, 'uFov', 1);
        this.f(p, 'uExposure', 0); this.f(p, 'uBrightness', 1); this.i(p, 'uColor', 0);
        gl.disable(gl.BLEND); gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
        cases.push({ distance, light: this.measure(target)[0] });
      }
      return { cases, expectedLight: 12, glError: gl.getError() };
    } finally {
      gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); this.destroyTarget(target);
      this.reductions.forEach(t => this.destroyTarget(t)); this.reductions = savedReductions;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /** Isolate the camera response with a fixed, isotropic, valid-domain shell. */
  auditProjection() {
    const gl = this.gl; const width = 320; const height = 240; const count = 80_000;
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
        this.f(p, 'uScale', .5); this.f(p, 'uFocus', 1); this.f(p, 'uBlur', 6);
        this.f(p, 'uFov', fov * Math.PI / 180); this.f(p, 'uExposure', -6); this.f(p, 'uBrightness', 1); this.i(p, 'uColor', 0);
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
    if (this.disposed) return; this.disposed = true; this.resizeObserver.disconnect(); const gl = this.gl;
    [...this.targets, ...this.reductions].forEach(t => this.destroyTarget(t));
    this.programs.forEach(p => gl.deleteProgram(p.program)); this.particleBuffers.forEach(b => gl.deleteBuffer(b));
    [...this.updateVAOs, ...this.drawVAOs, this.emptyVAO].forEach(v => gl.deleteVertexArray(v));
    gl.deleteTransformFeedback(this.feedback); gl.deleteTexture(this.profile);
  }
}
