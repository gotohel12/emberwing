// EMBERWING — WebGL renderer: lit meshes, procedural sky, cloud sea, particles, bloom + color grading
import { mul, perspective, lookAt, norm, sub, cross } from '../core/math.js';

const VS_MESH = `attribute vec3 aP;attribute vec3 aN;attribute vec4 aC;
uniform mat4 uVP,uM;uniform float uTime,uSway;varying vec3 vN,vW;varying vec4 vC;
void main(){vec4 w=uM*vec4(aP,1.);if(uSway>0.){float h=max(aP.y,0.);w.x+=sin(uTime*1.7+w.z*.05+w.x*.03)*h*uSway;w.z+=cos(uTime*1.3+w.x*.05)*h*uSway*.6;}
vW=w.xyz;vN=normalize(mat3(uM)*aN);vC=aC;gl_Position=uVP*w;}`;
const FS_MESH = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vN,vW;varying vec4 vC;
uniform vec3 uSun,uSunC,uSkyC,uGndC,uFogC,uEye;uniform vec2 uFog;uniform vec4 uTint;uniform float uEmit,uFogH,uA,uVA;
void main(){vec3 N=normalize(vN);vec3 V=normalize(uEye-vW);if(dot(N,V)<0.)N=-N;
vec3 base=mix(vC.rgb,uTint.rgb,uTint.a);float e=uVA>0.?uEmit:clamp(vC.a+uEmit,0.,1.);
float d=max(dot(N,uSun),0.);float hemi=.5+.5*N.y;vec3 amb=mix(uGndC,uSkyC,hemi);
vec3 H=normalize(uSun+V);float sp=pow(max(dot(N,H),0.),40.)*.25;
float rim=pow(1.-max(dot(N,V),0.),3.);
vec3 col=base*(amb*.75+d*uSunC)+sp*uSunC+rim*uSkyC*.25;
col=mix(col,base*1.6,e);
float dist=length(uEye-vW);float f=clamp((dist-uFog.x)/(uFog.y-uFog.x),0.,1.);
float hf=clamp((uFogH-vW.y)/400.,0.,1.)*.55;f=max(f,hf*clamp(dist/3000.,0.,1.));
col=mix(col,uFogC,f*f*(3.-2.*f));
gl_FragColor=vec4(col,uVA>0.?uA*vC.a:uA>0.?uA:e*(1.-f));}`;
const VS_FS = `attribute vec2 aP;varying vec2 vU;void main(){vU=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}`;
const FS_SKY = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vU;uniform mat4 uIVP;uniform vec3 uTop,uHor,uBot,uSun,uSunC,uEye;uniform float uTime,uStars,uCloud;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p*=2.07;a*=.5;}return s;}
void main(){vec4 a=uIVP*vec4(vU*2.-1.,1.,1.);vec3 D=normalize(a.xyz/a.w-uEye);
float y=D.y;vec3 c=y>0.?mix(uHor,uTop,pow(clamp(y,0.,1.),.55)):mix(uHor,uBot,pow(clamp(-y,0.,1.),.4));
float sd=max(dot(D,uSun),0.);c+=uSunC*(pow(sd,900.)*6.+pow(sd,24.)*.35+pow(sd,4.)*.12);
if(y>0.){vec2 cp=D.xz/(y+.12)*1.4+vec2(uTime*.012,uTime*.004);float cl=smoothstep(.45,.85,fb(cp)+uCloud-.5);
vec3 cc=mix(uHor*1.15,vec3(1.)*.9+uSunC*.3,.5+.5*sd);c=mix(c,cc,cl*smoothstep(0.,.25,y)*.75);
if(uStars>0.){vec2 sp=D.xz/(y+.3)*90.;float st=step(.996,h(floor(sp)))*smoothstep(.0,.3,y)*uStars*(.6+.4*sin(uTime*3.+h(floor(sp))*40.));c+=vec3(st);}}
gl_FragColor=vec4(c,clamp(pow(sd,600.)*2.,0.,1.)*.9);}`;
const VS_SEA = `attribute vec2 aP;uniform mat4 uVP;uniform vec3 uEye;uniform float uY;varying vec3 vW;void main(){vec3 w=vec3(aP.x*60000.+uEye.x,uY,aP.y*60000.+uEye.z);vW=w;gl_Position=uVP*vec4(w,1.);}`;
const FS_SEA = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vW;uniform vec3 uEye,uA,uB,uFogC,uSun;uniform float uTime;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p*=2.03;a*=.5;}return s;}
void main(){vec2 p=vW.xz*.00035+vec2(uTime*.006,uTime*.003);float n=fb(p)+fb(p*2.3-uTime*.01)*.5;
vec3 c=mix(uA,uB,smoothstep(.4,1.2,n));c+=uSun.y*.15*smoothstep(.9,1.3,n);float d=length(vW.xz-uEye.xz);
c=mix(c,uFogC,smoothstep(2000.,26000.,d));gl_FragColor=vec4(c,0.);}`;
const VS_PART = `attribute vec3 aP;attribute vec3 aQ;attribute vec4 aC;uniform mat4 uVP;uniform vec3 uR,uU;varying vec4 vC;varying vec2 vQ;
void main(){vC=aC;vQ=aQ.xy;vec3 w=aP+(uR*aQ.x+uU*aQ.y)*aQ.z;gl_Position=uVP*vec4(w,1.);}`;
const FS_PART = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec4 vC;varying vec2 vQ;uniform float uSoft;void main(){float r=length(vQ);float a=uSoft>0.?smoothstep(1.,0.,r):step(r,1.)*(1.-r*r);a=a*a;gl_FragColor=vec4(vC.rgb*vC.a*a,vC.a*a);}`;
const FS_BRIGHT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vU;uniform sampler2D uT;uniform vec2 uPx;void main(){vec3 s=vec3(0.);
for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){vec4 c=texture2D(uT,vU+vec2(float(i),float(j))*uPx);float l=dot(c.rgb,vec3(.3,.59,.11));s+=c.rgb*(c.a*1.2+smoothstep(.82,1.,l)*.6);}gl_FragColor=vec4(s/9.,1.);}`;
const FS_BLUR = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vU;uniform sampler2D uT;uniform vec2 uD;void main(){vec3 c=texture2D(uT,vU).rgb*.227;
c+=(texture2D(uT,vU+uD*1.384).rgb+texture2D(uT,vU-uD*1.384).rgb)*.316;c+=(texture2D(uT,vU+uD*3.23).rgb+texture2D(uT,vU-uD*3.23).rgb)*.07;gl_FragColor=vec4(c,1.);}`;
const FS_COMP = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vU;uniform sampler2D uT,uB;uniform float uBloom,uVig,uSat,uCon,uFlash,uAb,uTimeC;uniform vec3 uGrade,uFlashC;
void main(){vec2 c=vU-.5;vec3 col;if(uAb>0.){col.r=texture2D(uT,vU+c*uAb*.012).r;col.g=texture2D(uT,vU).g;col.b=texture2D(uT,vU-c*uAb*.012).b;}else col=texture2D(uT,vU).rgb;
col+=texture2D(uB,vU).rgb*uBloom;col*=uGrade;float l=dot(col,vec3(.3,.59,.11));col=mix(vec3(l),col,uSat);col=(col-.5)*uCon+.5;
col=col/(1.+max(col-1.,0.)*.5);col*=1.-dot(c,c)*uVig;col=mix(col,uFlashC,uFlash);
float g=fract(sin(dot(vU*uTimeC,vec2(12.9898,78.233)))*43758.5453);col+=(g-.5)*.012;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`;

function sh(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.slice(0, 200)); return s; }
function prog(gl, vs, fs, attrs) {
  const p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs));
  attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    const opts = { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;
    this.P = {
      mesh: prog(gl, VS_MESH, FS_MESH, ['aP', 'aN', 'aC']),
      sky: prog(gl, VS_FS, FS_SKY, ['aP']),
      sea: prog(gl, VS_SEA, FS_SEA, ['aP']),
      part: prog(gl, VS_PART, FS_PART, ['aP', 'aQ', 'aC']),
      bright: prog(gl, VS_FS, FS_BRIGHT, ['aP']),
      blur: prog(gl, VS_FS, FS_BLUR, ['aP']),
      comp: prog(gl, VS_FS, FS_COMP, ['aP'])
    };
    this.fsq = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.fsq); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.seaBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.seaBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.pBuf = gl.createBuffer(); this.pData = new Float32Array(6 * 10 * 6000);
    this.q = { scale: 1, bloom: true, maxDpr: 1.5 };
    this.env = null; this.fx = { flash: 0, flashC: [1, 1, 1], ab: 0 };
    this.time = 0; this.stats = { draws: 0, tris: 0 };
    this.resize();
  }
  setQuality(q) { Object.assign(this.q, q); this.resize(); }
  resize() {
    const gl = this.gl, dpr = Math.min(window.devicePixelRatio || 1, this.q.maxDpr);
    const w = Math.max(2, Math.floor(this.cv.clientWidth * dpr * this.q.scale)), h = Math.max(2, Math.floor(this.cv.clientHeight * dpr * this.q.scale));
    if (w === this.w && h === this.h && this.fbo) return;
    this.cv.width = w; this.cv.height = h; this.w = w; this.h = h;
    const mk = (W, H, depth) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (depth) { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, r); }
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f, W, H, ok };
    };
    for (const k of ['fbo', 'b1', 'b2']) if (this[k]) { gl.deleteTexture(this[k].t); gl.deleteFramebuffer(this[k].f); }
    this.fbo = mk(w, h, true);
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.b1 = mk(bw, bh, false); this.b2 = mk(bw, bh, false);
    this.post = this.fbo.ok;
  }
  upload(mb) {
    const gl = this.gl, b = gl.createBuffer(), arr = mb instanceof Float32Array ? mb : new Float32Array(mb.v);
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return { b, n: arr.length / 10 };
  }
  free(m) { if (m && m.b) this.gl.deleteBuffer(m.b); }
  setEnv(env) { this.env = env; }
  camera(eye, target, fovy, up = [0, 1, 0]) {
    this.eye = eye; this.view = lookAt(eye, target, up);
    this.proj = perspective(fovy, this.w / this.h, 3, 60000); this.vp = mul(this.proj, this.view);
    const f = norm(sub(target, eye)); this.camR = norm(cross(f, up)); this.camU = cross(this.camR, f); this.camF = f;
  }
  begin() {
    const gl = this.gl, E = this.env; this.stats.draws = 0; this.stats.tris = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.post ? this.fbo.f : null); gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    // sky
    const S = this.P.sky; gl.useProgram(S.p);
    gl.uniformMatrix4fv(S.u.uIVP, false, invert(this.vp)); gl.uniform3fv(S.u.uTop, E.skyTop); gl.uniform3fv(S.u.uHor, E.skyHor); gl.uniform3fv(S.u.uBot, E.skyBot);
    gl.uniform3fv(S.u.uSun, E.sun); gl.uniform3fv(S.u.uSunC, E.sunC); gl.uniform3fv(S.u.uEye, this.eye); gl.uniform1f(S.u.uTime, this.time); gl.uniform1f(S.u.uStars, E.stars || 0); gl.uniform1f(S.u.uCloud, E.cloud || 0.5);
    this.fs(S);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    // cloud sea
    const C = this.P.sea; gl.useProgram(C.p); gl.uniformMatrix4fv(C.u.uVP, false, this.vp); gl.uniform3fv(C.u.uEye, this.eye); gl.uniform1f(C.u.uY, E.seaY);
    gl.uniform3fv(C.u.uA, E.seaA); gl.uniform3fv(C.u.uB, E.seaB); gl.uniform3fv(C.u.uFogC, E.fogC); gl.uniform3fv(C.u.uSun, E.sun); gl.uniform1f(C.u.uTime, this.time);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seaBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    // mesh program state
    const M = this.P.mesh; gl.useProgram(M.p);
    gl.uniformMatrix4fv(M.u.uVP, false, this.vp); gl.uniform3fv(M.u.uSun, E.sun); gl.uniform3fv(M.u.uSunC, E.sunC); gl.uniform3fv(M.u.uSkyC, E.amb); gl.uniform3fv(M.u.uGndC, E.gnd);
    gl.uniform3fv(M.u.uFogC, E.fogC); gl.uniform2f(M.u.uFog, E.fogN, E.fogF); gl.uniform3fv(M.u.uEye, this.eye); gl.uniform1f(M.u.uTime, this.time); gl.uniform1f(M.u.uFogH, E.fogH || -1e9);
    gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.disable(gl.CULL_FACE);
  }
  draw(mesh, M, o) {
    if (!mesh || !mesh.n) return;
    const gl = this.gl, P = this.P.mesh;
    gl.uniformMatrix4fv(P.u.uM, false, M);
    gl.uniform4fv(P.u.uTint, o && o.tint ? o.tint : ZERO4); gl.uniform1f(P.u.uEmit, o && o.emit || 0); gl.uniform1f(P.u.uSway, o && o.sway || 0); gl.uniform1f(P.u.uA, o && o.alpha || 0); gl.uniform1f(P.u.uVA, o && o.vAlpha ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.b);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
    this.stats.draws++; this.stats.tris += mesh.n / 3;
  }
  /** particles: array of {p:[x,y,z], s:size, c:[r,g,b], a:alpha}, blend 'add' | 'alpha' */
  particles(list, blend = 'add', soft = 1) {
    if (!list.length) return;
    const gl = this.gl, P = this.P.part, d = this.pData, max = Math.min(list.length, 6000); let o = 0;
    const Q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < max; i++) {
      const q = list[i];
      for (let k = 0; k < 6; k++) { d[o++] = q.p[0]; d[o++] = q.p[1]; d[o++] = q.p[2]; d[o++] = Q[k][0]; d[o++] = Q[k][1]; d[o++] = q.s; d[o++] = q.c[0]; d[o++] = q.c[1]; d[o++] = q.c[2]; d[o++] = q.a; }
    }
    gl.useProgram(P.p); gl.uniformMatrix4fv(P.u.uVP, false, this.vp); gl.uniform3fv(P.u.uR, this.camR); gl.uniform3fv(P.u.uU, this.camU); gl.uniform1f(P.u.uSoft, soft);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf); gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, max * 6);
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.useProgram(this.P.mesh.p);
    this.stats.draws++;
  }
  /** additive transparent mesh (light shafts, rings) */
  drawAdd(mesh, M, o) {
    const gl = this.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    this.draw(mesh, M, o); gl.disable(gl.BLEND); gl.depthMask(true);
  }
  /** alpha-blended mesh (storm wall, shadows) */
  drawBlend(mesh, M, o) {
    const gl = this.gl; gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
    this.draw(mesh, M, o); gl.disable(gl.BLEND); gl.depthMask(true);
  }
  end() {
    const gl = this.gl, E = this.env;
    if (!this.post) return;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    let bloom = 0;
    if (this.q.bloom) {
      const B = this.P.bright; gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1.f); gl.viewport(0, 0, this.b1.W, this.b1.H); gl.useProgram(B.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbo.t); gl.uniform1i(B.u.uT, 0); gl.uniform2f(B.u.uPx, 1.5 / this.w, 1.5 / this.h); this.fs(B);
      const L = this.P.blur; gl.useProgram(L.p); gl.uniform1i(L.u.uT, 0);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b2.f); gl.bindTexture(gl.TEXTURE_2D, this.b1.t); gl.uniform2f(L.u.uD, (1 + i) / this.b1.W, 0); this.fs(L);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1.f); gl.bindTexture(gl.TEXTURE_2D, this.b2.t); gl.uniform2f(L.u.uD, 0, (1 + i) / this.b1.H); this.fs(L);
      }
      bloom = E.bloom == null ? 1.1 : E.bloom;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    const C = this.P.comp; gl.useProgram(C.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbo.t); gl.uniform1i(C.u.uT, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.b1.t); gl.uniform1i(C.u.uB, 1); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(C.u.uBloom, bloom); gl.uniform1f(C.u.uVig, E.vig == null ? 0.9 : E.vig); gl.uniform1f(C.u.uSat, E.sat || 1.1); gl.uniform1f(C.u.uCon, E.con || 1.05);
    gl.uniform3fv(C.u.uGrade, E.grade || [1, 1, 1]); gl.uniform1f(C.u.uFlash, this.fx.flash); gl.uniform3fv(C.u.uFlashC, this.fx.flashC); gl.uniform1f(C.u.uAb, this.fx.ab); gl.uniform1f(C.u.uTimeC, (this.time % 10) + 1);
    this.fs(C);
  }
  fs(P) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.fsq); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
}
const ZERO4 = new Float32Array(4);

function invert(m) {
  const inv = new Float32Array(16), a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12]; det = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) inv[i] *= det; return inv;
}
