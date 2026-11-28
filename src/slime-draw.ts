// The slime on the GPU (WebGL2): a Jones-style agent swarm. Every agent senses the trail ahead-left, ahead and ahead-right, turns
// toward the strongest, steps, and deposits; the trail is blurred and decays (ping-pong framebuffers). Agent state lives in a float
// texture, one texel per agent; a point draw adds the deposits. Also the 2D overlay (oat flakes, the real railway, labels).
import type {Pt, World} from './slime-sim.ts';

export const MAX_OATS = 48;
export type Params = {sa: number; ra: number; so: number; ss: number; tw: number; sw: number; gw: number; jit: number; dep: number; diff: number; decay: number; starve: number; k: number; lambda: number; sat: number};

const FS_QUAD = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
const HEAD = '#version 300 es\nprecision highp float;precision highp int;\n';

const UPDATE = HEAD + `
uniform sampler2D uAgents,uTrail,uScent,uMask,uGuide;
uniform vec2 uGrid,uSpawn[${MAX_OATS + 1}];
uniform int uSpawnN,uFrame;
uniform float uSA,uRA,uSO,uSS,uTW,uSW,uGW,uJit,uStarve,uSpawnR,uSat;
out vec4 o;
uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}
float sense(vec2 p,float a){
  vec2 q=p+vec2(cos(a),sin(a))*uSO;
  if(q.x<1.0||q.y<1.0||q.x>uGrid.x-1.0||q.y>uGrid.y-1.0)return -1e4;
  vec2 uv=q/uGrid;
  if(texture(uMask,uv).r>0.5)return -1e4;
  float t=texture(uTrail,uv).r;return uTW*t/(1.0+uSat*t)+uSW*texture(uScent,uv).r+uGW*texture(uGuide,uv).r;
}
void main(){
  ivec2 c=ivec2(gl_FragCoord.xy);
  vec4 a=texelFetch(uAgents,c,0);
  uint s=pcg(uint(c.x)+uint(c.y)*4096u+uint(uFrame)*2654435761u);
  s=pcg(s);float r1=float(s)/4294967296.0;
  s=pcg(s);float r2=float(s)/4294967296.0;
  s=pcg(s);float r3=float(s)/4294967296.0;
  vec2 p=a.xy;float h=a.z;
  vec2 uv=p/uGrid;
  bool dead=texture(uMask,uv).r>0.5;
  if(!dead&&uStarve>0.0){float g=texture(uGuide,uv).r;dead=g<0.25&&r3<uStarve*(1.0-g/0.25);}
  if(dead){
    int i=int(r1*float(uSpawnN));i=min(i,uSpawnN-1);
    float ang=r2*6.2831853,rad=sqrt(fract(r1*float(uSpawnN)))*uSpawnR;
    vec2 q=uSpawn[i]+vec2(cos(ang),sin(ang))*rad;
    o=vec4(q,r3*6.2831853,0.0);return;
  }
  float L=sense(p,h-uSA),C=sense(p,h),R=sense(p,h+uSA);
  if(C>L&&C>R){}
  else if(C<L&&C<R){h+=r1<0.5?uRA:-uRA;}
  else if(L>R){h-=uRA;}
  else if(R>L){h+=uRA;}
  h+=(r2-0.5)*2.0*uJit;
  vec2 n=p+vec2(cos(h),sin(h))*uSS;
  bool bad=n.x<1.0||n.y<1.0||n.x>uGrid.x-1.0||n.y>uGrid.y-1.0||texture(uMask,n/uGrid).r>0.5;
  if(bad){o=vec4(p,r3*6.2831853,0.0);}else{o=vec4(n,h,0.0);}
}`;
const DEPOSIT_VS = HEAD + `
uniform sampler2D uAgents;uniform int uS;uniform vec2 uGrid;
void main(){
  vec4 a=texelFetch(uAgents,ivec2(gl_VertexID%uS,gl_VertexID/uS),0);
  gl_Position=vec4(a.x/uGrid.x*2.0-1.0,a.y/uGrid.y*2.0-1.0,0.0,1.0);gl_PointSize=1.0;
}`;
const DEPOSIT_FS = HEAD + 'uniform float uDep;out vec4 o;void main(){o=vec4(uDep,0.0,0.0,0.0);}';
const SPLAT_VS = HEAD + `
uniform vec2 uOat[${MAX_OATS}],uGrid;uniform float uSize;
void main(){vec2 p=uOat[gl_VertexID];gl_Position=vec4(p.x/uGrid.x*2.0-1.0,p.y/uGrid.y*2.0-1.0,0.0,1.0);gl_PointSize=uSize;}`;
const SPLAT_FS = HEAD + 'uniform float uVal;out vec4 o;void main(){float d=length(gl_PointCoord-0.5)*2.0;o=vec4(uVal*smoothstep(1.0,0.2,d),0.0,0.0,0.0);}';
const DIFFUSE = HEAD + `
uniform sampler2D uTrail,uMask;uniform float uDiff,uDecay;
out vec4 o;
void main(){
  ivec2 c=ivec2(gl_FragCoord.xy),sz=textureSize(uTrail,0);
  if(texelFetch(uMask,c,0).r>0.5){o=vec4(0.0);return;}
  float s=0.0;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++)s+=texelFetch(uTrail,clamp(c+ivec2(i,j),ivec2(0),sz-1),0).r;
  float t=texelFetch(uTrail,c,0).r;
  o=vec4(mix(t,s/9.0,uDiff)*uDecay,0.0,0.0,0.0);
}`;
const SCENT = HEAD + `
uniform vec2 uOat[${MAX_OATS}],uGrid,uOut;uniform int uN;uniform float uLambda;out vec4 o;
void main(){
  vec2 p=gl_FragCoord.xy/uOut*uGrid;
  float s=0.0;
  for(int i=0;i<${MAX_OATS};i++){if(i>=uN)break;s+=exp(-distance(p,uOat[i])/uLambda);}
  o=vec4(min(s,1.5),0.0,0.0,0.0);
}`;
const PROBE = HEAD + `
uniform sampler2D uTrail;uniform vec2 uOat[${MAX_OATS}],uGrid;out vec4 o;
void main(){
  vec2 uv=uOat[int(gl_FragCoord.x)]/uGrid;float m=0.0;
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++)m=max(m,texture(uTrail,uv+vec2(i,j)*1.5/uGrid).r);
  o=vec4(m,0.0,0.0,0.0);
}`;
const RENDER = HEAD + `
uniform sampler2D uTrail,uMask;uniform vec2 uCanvas;uniform float uK;uniform int uMaze;
out vec4 o;
void main(){
  vec2 uv=vec2(gl_FragCoord.x/uCanvas.x,1.0-gl_FragCoord.y/uCanvas.y);
  float t=texture(uTrail,uv).r,m=texture(uMask,uv).r;
  vec3 agar=mix(vec3(0.957,0.925,0.812),vec3(0.894,0.851,0.718),smoothstep(0.25,0.85,length(uv-0.5)*1.25));
  float d=1.0-exp(-t*uK);
  vec3 c=agar;
  c=mix(c,c*vec3(1.0,0.84,0.42),smoothstep(0.0,0.22,d)*0.65);
  c=mix(c,vec3(1.0,0.80,0.12),smoothstep(0.08,0.6,d));
  c=mix(c,vec3(0.96,0.62,0.05),smoothstep(0.6,1.0,d)*0.55);
  c+=vec3(0.07,0.06,0.0)*smoothstep(0.25,0.55,d)*(1.0-smoothstep(0.55,0.9,d));
  float lit=smoothstep(0.35,0.65,m);
  vec3 wall=uMaze==1?vec3(0.13,0.115,0.10):vec3(0.968,0.972,0.965);
  if(uMaze==0)wall=mix(wall,vec3(0.90,0.945,0.96),smoothstep(0.0,1.0,0.5+0.5*sin((gl_FragCoord.x+gl_FragCoord.y)*0.45))*0.35);
  c=mix(c,wall,lit);
  float e=1.0-smoothstep(0.0,0.2,abs(m-0.5));
  c=mix(c,uMaze==1?vec3(0.36,0.31,0.24):vec3(0.55,0.46,0.27),e*0.8);
  o=vec4(c,1.0);
}`;

export class Physarum {
  gl: WebGL2RenderingContext;
  W: number;
  H: number;
  S: number;
  rows = 0;
  frame = 0;
  P: Params;
  reached: boolean[] = [];
  private prog: Record<string, WebGLProgram> = {};
  private loc = new Map<string, WebGLUniformLocation | null>();
  private agents: WebGLTexture[] = [];
  private agentFbo: WebGLFramebuffer[] = [];
  private trail: WebGLTexture[] = [];
  private trailFbo: WebGLFramebuffer[] = [];
  private cur = 0;
  private tcur = 0;
  private scent!: WebGLTexture;
  private scentFbo!: WebGLFramebuffer;
  private mask!: WebGLTexture;
  private guide!: WebGLTexture;
  private probe!: WebGLTexture;
  private probeFbo!: WebGLFramebuffer;
  private nearest!: WebGLSampler;
  private linear!: WebGLSampler;
  private vao: WebGLVertexArrayObject;
  private world!: World;
  private spawn: Pt[] = [];
  private oatArr = new Float32Array(MAX_OATS * 2);
  private maze = 0;
  private guideOn = false;
  private scentDirty = true;

  constructor(canvas: HTMLCanvasElement, W: number, H: number, S: number, P: Params) {
    const gl = canvas.getContext('webgl2', {antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance'});
    if (!gl) throw new Error('no webgl2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no float render targets');
    this.gl = gl;
    (this.W = W), (this.H = H), (this.S = S), (this.P = P);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const mk = (n: string, vs: string, fs: string) => (this.prog[n] = this.link(vs, fs));
    mk('update', FS_QUAD, UPDATE);
    mk('deposit', DEPOSIT_VS, DEPOSIT_FS);
    mk('splat', SPLAT_VS, SPLAT_FS);
    mk('diffuse', FS_QUAD, DIFFUSE);
    mk('scent', FS_QUAD, SCENT);
    mk('probe', FS_QUAD, PROBE);
    mk('render', FS_QUAD, RENDER);
    this.nearest = gl.createSampler()!;
    this.linear = gl.createSampler()!;
    for (const [s, f] of [[this.nearest, gl.NEAREST], [this.linear, gl.LINEAR]] as const) {
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, f);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, f);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const tex = (w: number, h: number, ifmt: number, fmt: number, type: number, data: ArrayBufferView | null = null) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
      if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, fmt, type, data);
      return t;
    };
    const fbo = (t: WebGLTexture) => {
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return f;
    };
    for (let i = 0; i < 2; i++) {
      this.agents.push(tex(S, S, gl.RGBA32F, gl.RGBA, gl.FLOAT));
      this.agentFbo.push(fbo(this.agents[i]));
      this.trail.push(tex(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT));
      this.trailFbo.push(fbo(this.trail[i]));
    }
    const sw = Math.ceil(W / 2), sh = Math.ceil(H / 2);
    this.scent = tex(sw, sh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this.scentFbo = fbo(this.scent);
    this.mask = tex(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
    this.guide = tex(Math.ceil(W / 4), Math.ceil(H / 4), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(Math.ceil(W / 4) * Math.ceil(H / 4) * 4));
    this.probe = tex(MAX_OATS, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    this.probeFbo = fbo(this.probe);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private link(vs: string, fs: string) {
    const gl = this.gl, sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }
  private use(name: string) {
    this.gl.useProgram(this.prog[name]);
    this.cp = name;
    return this;
  }
  private cp = '';
  private u(n: string) {
    const k = `${this.cp}.${n}`;
    if (!this.loc.has(k)) this.loc.set(k, this.gl.getUniformLocation(this.prog[this.cp], n));
    return this.loc.get(k)!;
  }
  private bindTex(unit: number, t: WebGLTexture, smp: WebGLSampler, uniform: string) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.bindSampler(unit, smp);
    gl.uniform1i(this.u(uniform), unit);
  }

  /** Load a world: its mask, oats, and a fresh swarm (n agents placed by `place`). */
  setWorld(w: World, place: (i: number) => Pt) {
    const gl = this.gl;
    this.world = w;
    this.maze = w.kind === 'maze' ? 1 : 0;
    this.reached = w.oats.map(() => false);
    this.spawn = [w.start];
    this.uploadMask();
    this.scentDirty = true;
    const n = this.S * this.S, data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = place(i);
      (data[4 * i] = p.x), (data[4 * i + 1] = p.y), (data[4 * i + 2] = Math.random() * 6.2831853);
    }
    for (const t of this.agents) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.S, this.S, gl.RGBA, gl.FLOAT, data);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const f of this.trailFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.frame = 0;
  }
  /** Re-upload the mask after the world's cells changed (painted light). */
  uploadMask() {
    const gl = this.gl, b = this.world.blocked, m = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) m[i] = b[i] ? 255 : 0;
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RED, gl.UNSIGNED_BYTE, m);
  }
  /** Oats changed: recompute the scent. */
  oatsChanged() {
    this.scentDirty = true;
  }
  /** Where a starved or lit-over agent restarts: the start and every oat the slime has reached. */
  setSpawn(p: Pt[]) {
    this.spawn = p.slice(0, MAX_OATS);
  }
  setGuide(canvas: HTMLCanvasElement | null) {
    const gl = this.gl;
    this.guideOn = !!canvas;
    if (!canvas) return;
    gl.bindTexture(gl.TEXTURE_2D, this.guide);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }
  clearGuide() {
    const gl = this.gl, n = Math.ceil(this.W / 4) * Math.ceil(this.H / 4) * 4;
    this.guideOn = false;
    gl.bindTexture(gl.TEXTURE_2D, this.guide);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Math.ceil(this.W / 4), Math.ceil(this.H / 4), gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(n));
  }

  private oats() {
    const o = this.world.oats;
    for (let i = 0; i < o.length && i < MAX_OATS; i++) ((this.oatArr[2 * i] = o[i].x), (this.oatArr[2 * i + 1] = o[i].y));
    return Math.min(o.length, MAX_OATS);
  }
  private makeScent() {
    const gl = this.gl, n = this.oats();
    this.scentDirty = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scentFbo);
    gl.viewport(0, 0, Math.ceil(this.W / 2), Math.ceil(this.H / 2));
    this.use('scent');
    gl.uniform2f(this.u('uOut'), Math.ceil(this.W / 2), Math.ceil(this.H / 2));
    gl.uniform2fv(this.u('uOat'), this.oatArr);
    gl.uniform2f(this.u('uGrid'), this.W, this.H);
    gl.uniform1i(this.u('uN'), n);
    gl.uniform1f(this.u('uLambda'), this.P.lambda);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** One simulation step for the first `rows` rows of agents. */
  step() {
    const gl = this.gl, P = this.P, S = this.S, W = this.W, H = this.H, rows = this.rows;
    if (!rows) return;
    if (this.scentDirty) this.makeScent();
    gl.disable(gl.BLEND);
    // 1. agents sense, turn and move
    this.use('update');
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentFbo[1 - this.cur]);
    gl.viewport(0, 0, S, rows);
    this.bindTex(0, this.agents[this.cur], this.nearest, 'uAgents');
    this.bindTex(1, this.trail[this.tcur], this.linear, 'uTrail');
    this.bindTex(2, this.scent, this.linear, 'uScent');
    this.bindTex(3, this.mask, this.nearest, 'uMask');
    this.bindTex(4, this.guide, this.linear, 'uGuide');
    gl.uniform2f(this.u('uGrid'), W, H);
    gl.uniform1f(this.u('uSA'), P.sa);
    gl.uniform1f(this.u('uRA'), P.ra);
    gl.uniform1f(this.u('uSO'), P.so);
    gl.uniform1f(this.u('uSS'), P.ss);
    gl.uniform1f(this.u('uTW'), P.tw);
    gl.uniform1f(this.u('uSW'), P.sw);
    gl.uniform1f(this.u('uSat'), P.sat);
    gl.uniform1f(this.u('uGW'), this.guideOn ? P.gw : 0);
    gl.uniform1f(this.u('uJit'), P.jit);
    gl.uniform1f(this.u('uStarve'), this.guideOn ? P.starve : 0);
    gl.uniform1f(this.u('uSpawnR'), 6 * (W / 960));
    gl.uniform1i(this.u('uFrame'), this.frame++);
    const sp = new Float32Array((MAX_OATS + 1) * 2);
    this.spawn.forEach((p, i) => ((sp[2 * i] = p.x), (sp[2 * i + 1] = p.y)));
    gl.uniform2fv(this.u('uSpawn'), sp);
    gl.uniform1i(this.u('uSpawnN'), Math.max(1, this.spawn.length));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
    // 2. deposit
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo[this.tcur]);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.use('deposit');
    this.bindTex(0, this.agents[this.cur], this.nearest, 'uAgents');
    gl.uniform1i(this.u('uS'), S);
    gl.uniform2f(this.u('uGrid'), W, H);
    gl.uniform1f(this.u('uDep'), P.dep);
    gl.drawArrays(gl.POINTS, 0, rows * S);
    // oats the slime has reached keep feeding the trail
    const hit: number[] = [];
    this.reached.forEach((r, i) => r && i < MAX_OATS && hit.push(i));
    if (hit.length) {
      this.use('splat');
      const a = new Float32Array(MAX_OATS * 2);
      hit.forEach((i, j) => ((a[2 * j] = this.world.oats[i].x), (a[2 * j + 1] = this.world.oats[i].y)));
      gl.uniform2fv(this.u('uOat'), a);
      gl.uniform2f(this.u('uGrid'), W, H);
      gl.uniform1f(this.u('uSize'), Math.max(3, 7 * (W / 960)));
      gl.uniform1f(this.u('uVal'), P.dep * 3);
      gl.drawArrays(gl.POINTS, 0, hit.length);
    }
    gl.disable(gl.BLEND);
    // 3. blur and decay into the other trail texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo[1 - this.tcur]);
    this.use('diffuse');
    this.bindTex(0, this.trail[this.tcur], this.nearest, 'uTrail');
    this.bindTex(1, this.mask, this.nearest, 'uMask');
    gl.uniform1f(this.u('uDiff'), P.diff);
    gl.uniform1f(this.u('uDecay'), P.decay);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.tcur = 1 - this.tcur;
  }

  /** The trail strength at each oat (largest in a 5 x 5 patch): one tiny draw and a 48-texel read. */
  readOats(): Float32Array {
    const gl = this.gl, n = MAX_OATS, out = new Float32Array(n * 4);
    this.oats();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo);
    gl.viewport(0, 0, n, 1);
    gl.disable(gl.BLEND);
    this.use('probe');
    this.bindTex(0, this.trail[this.tcur], this.linear, 'uTrail');
    gl.uniform2fv(this.u('uOat'), this.oatArr);
    gl.uniform2f(this.u('uGrid'), this.W, this.H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, out);
    return Float32Array.from({length: n}, (_, i) => out[4 * i]);
  }

  render(cw: number, ch: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.BLEND);
    this.use('render');
    this.bindTex(0, this.trail[this.tcur], this.linear, 'uTrail');
    this.bindTex(1, this.mask, this.linear, 'uMask');
    gl.uniform2f(this.u('uCanvas'), cw, ch);
    gl.uniform1f(this.u('uK'), this.P.k);
    gl.uniform1i(this.u('uMaze'), this.maze);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// ------------------------------------------------------------------ the overlay: oat flakes, the real railway, labels
const flake = (g: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, glow: boolean) => {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  if (glow) {
    g.fillStyle = 'rgba(255,214,70,0.45)';
    g.beginPath();
    g.ellipse(0, 0, 10, 7.5, 0, 0, 6.2832);
    g.fill();
  }
  g.fillStyle = 'rgba(70,48,12,0.28)';
  g.beginPath();
  g.ellipse(1.2, 1.8, 6.2, 4.4, 0, 0, 6.2832);
  g.fill();
  const gr = g.createLinearGradient(-6, -4, 6, 4);
  gr.addColorStop(0, '#f6ebcb');
  gr.addColorStop(1, '#d9c08a');
  g.fillStyle = gr;
  g.strokeStyle = '#a2814a';
  g.lineWidth = 0.9;
  g.beginPath();
  g.ellipse(0, 0, 6, 4.2, 0, 0, 6.2832);
  g.fill();
  g.stroke();
  g.strokeStyle = 'rgba(162,129,74,0.55)';
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(-3.6, 0.2);
  g.quadraticCurveTo(0, -1.4, 3.6, 0.4);
  g.stroke();
  g.restore();
};
export type OatDraw = {p: Pt; reached: boolean; born: number};
export const drawOverlay = (g: CanvasRenderingContext2D, cw: number, ch: number, gw: number, gh: number, oats: OatDraw[], now: number, rail: number[][] | null, tokyo: Pt | null, ring: Pt | null) => {
  g.clearRect(0, 0, cw, ch);
  const sx = cw / gw, sy = ch / gh, s = Math.max(0.85, Math.min(1.25, cw / 560));
  if (rail) {
    g.strokeStyle = 'rgba(214,40,40,0.92)';
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    g.beginPath();
    for (const [x0, y0, x1, y1] of rail) (g.moveTo(x0 * sx, y0 * sy), g.lineTo(x1 * sx, y1 * sy));
    g.stroke();
  }
  if (ring) {
    g.strokeStyle = 'rgba(60,40,10,0.5)';
    g.setLineDash([3, 4]);
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(ring.x * sx, ring.y * sy, 10 * s, 0, 6.2832);
    g.stroke();
    g.setLineDash([]);
  }
  oats.forEach((o, i) => {
    const age = Math.max(0, Math.min(1, (now - o.born) / 260));
    if (!age && now < o.born) return;
    const pop = age < 1 ? 1 + 0.5 * Math.sin(age * Math.PI) * (1 - age) * 2 : 1;
    flake(g, o.p.x * sx, o.p.y * sy - (1 - age) * 14 * s, s * pop * age, (i * 2.399) % 3.1416, o.reached);
  });
  if (tokyo) {
    const f = `600 ${Math.round(12 * Math.min(1.1, s))}px Inter, system-ui, sans-serif`, x = tokyo.x * sx, y = tokyo.y * sy;
    g.font = f;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const tw = g.measureText('Tokyo').width;
    g.fillStyle = 'rgba(21,18,15,0.82)';
    g.beginPath();
    g.roundRect(x + 11 * s, y - 9, tw + 12, 18, 5);
    g.fill();
    g.fillStyle = '#ffd23f';
    g.fillText('Tokyo', x + 17 * s, y + 0.5);
  }
};
