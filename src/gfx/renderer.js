// ARVEX SURVIVAL — WebGL renderer
// lit meshes (hemisphere + sun + 6 point lights + procedural detail), sky with sun/moon/clouds/stars,
// heightmap-aware water, GPU rain, particles, bloom, colour grading. Depth: 24-bit (DEPTH_STENCIL).
import { TextureBank, TEX_SETS, TEX_LAYERS, MAT_LAYER } from './textures.js';
import { mul, perspective, lookAt, norm, sub, cross } from '../core/math.js';

const P_HI = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
export const MAX_LIGHTS = 6;
const VS_MESH = `attribute vec3 aP;attribute vec3 aN;attribute vec4 aC;
uniform mat4 uVP,uM;uniform float uTime,uWind;varying vec3 vN,vW;varying vec4 vC;
uniform float uMatL[8],uLocal;uniform vec4 uLay[5];uniform vec3 uAvg[5];varying vec3 vT,vTN,vAvg;varying vec4 vLq;
varying vec3 vUV;
float fwa(){return aC.a<-19.5?(aC.b>0.?-1.-aC.b:0.):aC.a<-9.?aC.a+10.:aC.a;}
vec3 fnl(){return aC.a<-19.5?aN:aC.a<-9.?(aN.z<-900.?vec3(0.,1.,0.):normalize(vec3(aP.x,(aP.y-aN.z)*.8,aP.z)+vec3(0.,.02,0.))):aN;}
void matv(vec3 lp,vec3 ln){bool tx=aC.a<-19.5;vUV=tx?vec3(aC.rg,aC.a<-20.5?3.:2.):aC.a<-9.?vec3(aN.xy,1.):vec3(0.);float mt=aC.a>=0.?floor(aC.a*.5+.001):0.;vC=tx?vec4(1.,1.,1.,0.):vec4(aC.rgb,aC.a>=0.?aC.a-2.*mt:fwa());float l=tx?-1.:uMatL[int(mt)];int li=int(max(l,0.)+.5);
vLq=vec4(l,uLay[li].xyz);vAvg=uAvg[li];if(uLocal>.5){vT=lp;vTN=ln;}else{vT=vW;vTN=vN;}}
void main(){vec4 w=uM*vec4(aP,1.);float fa=fwa();
if(fa<-.5){float k=-fa-1.;w.x+=sin(uTime*1.6+w.z*.21+w.x*.13)*k*uWind;w.z+=cos(uTime*1.3+w.x*.17)*k*uWind*.6;}
vW=w.xyz;vN=normalize(mat3(uM)*fnl());matv(aP,aN);gl_Position=uVP*w;}`;
const fsMesh = tex => '#ifdef GL_OES_standard_derivatives\n#extension GL_OES_standard_derivatives : enable\n#define DRV\n#endif\n' + P_HI + (tex ? '#define TEX\n' : '') + `varying vec3 vN,vW;varying vec4 vC;varying vec3 vUV;uniform sampler2D uLeaf,uMod,uModN;
uniform vec3 uSun,uSunC,uSkyC,uGndC,uFogC,uEye;uniform vec2 uFog;uniform vec4 uTint;uniform float uEmit,uA,uDetail,uWet,uFogH;
uniform vec3 uLP[${MAX_LIGHTS}];uniform vec4 uLC[${MAX_LIGHTS}];uniform sampler2D uSM;uniform mat4 uLVP;uniform float uSOn,uSMs;
float unpk(vec4 c){return dot(c,vec4(1./16777216.,1./65536.,1./256.,1.));}
float shadowAt(vec3 w,vec3 N){if(uSOn<=0.)return 1.;vec4 lp=uLVP*vec4(w+N*.06,1.);vec3 q=lp.xyz/lp.w*.5+.5;if(q.x<0.||q.y<0.||q.x>1.||q.y>1.||q.z>1.)return 1.;float t=1./uSMs,s=0.;
for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){s+=step(q.z-.0012,unpk(texture2D(uSM,q.xy+vec2(float(i),float(j))*t*1.2)));}s/=9.;
vec2 e=min(q.xy,1.-q.xy);float fade=clamp(min(e.x,e.y)*12.,0.,1.);return mix(1.,mix(1.,s,uSOn),fade);}
#ifdef TEX
varying vec3 vT,vTN,vAvg;varying vec4 vLq;
uniform sampler2D uD0,uD1,uD2,uD3,uD4,uN0,uN1,uN2,uN3,uN4;uniform vec4 uTL[4];uniform vec3 uTA[4];uniform float uTerr,uTexD,uLoc;uniform mat3 uNM;
vec4 sD(int l,vec2 u){if(l==0)return texture2D(uD0,u);if(l==1)return texture2D(uD1,u);if(l==2)return texture2D(uD2,u);if(l==3)return texture2D(uD3,u);return texture2D(uD4,u);}
vec4 sN(int l,vec2 u){if(l==0)return texture2D(uN0,u);if(l==1)return texture2D(uN1,u);if(l==2)return texture2D(uN2,u);if(l==3)return texture2D(uN3,u);return texture2D(uN4,u);}
void tri(int l,vec3 p,vec3 n,float sc,out vec3 alb,out vec3 nn,out float r){vec3 w=abs(n);w*=w;w*=w;w/=(w.x+w.y+w.z);
vec2 ux=p.zy*sc,uy=p.xz*sc,uz=p.xy*sc;vec4 ax=sD(l,ux),ay=sD(l,uy),az=sD(l,uz),bx=sN(l,ux),by=sN(l,uy),bz=sN(l,uz);
alb=ax.rgb*w.x+ay.rgb*w.y+az.rgb*w.z;r=bx.b*w.x+by.b*w.y+bz.b*w.z;
vec3 nx=vec3(bx.xy*2.-1.+n.zy,n.x),ny=vec3(by.xy*2.-1.+n.xz,n.y),nz=vec3(bz.xy*2.-1.+n.xy,n.z);nn=normalize(nx.zyx*w.x+ny.xzy*w.y+nz.xyz*w.z);}
vec3 tnt(vec3 a,vec3 b,vec3 avg,float k){return mix(a,b*(dot(a,vec3(.3,.59,.11))/dot(avg,vec3(.3,.59,.11))),k);}
void top(int l,vec3 p,float sc,float far,out vec3 alb,out vec2 tn,out float r){vec2 u=p.xz*sc;vec4 a=sD(l,u),b=sN(l,u);vec3 f=sD(l,u*.23+.37).rgb;alb=mix(a.rgb,f,far);tn=(b.xy*2.-1.)*(1.-far*.8);r=b.b;}
#endif
float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){vec3 N=normalize(vN);vec3 V=normalize(uEye-vW);float lf=0.;vec4 tl=vec4(1.);
float txm=0.;float fh=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
if(vUV.z>1.5){tl=texture2D(uMod,vUV.xy);if(tl.a<mix(.5,.28+fh*.44,clamp((length(uEye-vW)-30.)/90.,0.,1.)))discard;txm=1.;if(vUV.z>2.5)lf=1.;if(dot(N,V)<0.)N=-N;}
else if(vUV.z>.5){tl=texture2D(uLeaf,vUV.xy);if(tl.a<mix(.42,.3+fh*.42,clamp((length(uEye-vW)-22.)/70.,0.,1.)))discard;lf=1.;}else if(dot(N,V)<0.)N=-N;
float e=clamp(vC.a,0.,1.)+uEmit;vec3 base=mix(vC.rgb,uTint.rgb,uTint.a);if(txm>.5){vec3 tc=tl.rgb;if(lf>.5)tc=mix(vec3(dot(tc,vec3(.3,.59,.11))),tc,1.4)*.6;base=mix(tc,uTint.rgb,uTint.a);}else if(lf>.5)base*=tl.rgb*1.62;
if(uDetail>0.){float d=length(uEye-vW);float k=clamp(1.-d/140.,0.,1.)*uDetail;
float n=n3(vW*2.3)*.5+n3(vW*7.9)*.35+n3(vW*.6)*.25;base*=1.+(n-.55)*.34*k+(n3(vW*.05)-.5)*.1*uDetail;}
base*=1.-uWet*.28;
#ifdef TEX
float rough=.86,metal=0.,skin=0.;vec3 Ng=N;float td=length(uEye-vW);float tf=clamp(1.-(td-uTexD*.65)/(uTexD*.35),0.,1.);
if(txm>.5){vec4 nm=texture2D(uModN,vUV.xy);rough=clamp(nm.b,.1,1.);metal=nm.a;
#ifdef DRV
if(lf<.5&&td<60.){vec3 q1=dFdx(vW),q2=dFdy(vW);vec2 s1=dFdx(vUV.xy),s2=dFdy(vUV.xy);vec3 c2=cross(q2,Ng),c1=cross(Ng,q1);vec3 T=c2*s1.x+c1*s2.x,B=c2*s1.y+c1*s2.y;float im=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-12));vec2 t=(nm.xy*2.-1.)*clamp(1.-td/60.,0.,1.);t.y=-t.y;N=normalize(Ng+(T*t.x+B*t.y)*im);}
#endif
tf=0.;}
if(tf>0.){
if(uTerr>.5){float hh=vW.y,sl=1.-Ng.y,nz=n3(vW*.06)*.6+n3(vW*.21)*.4,far=clamp(td/55.,0.,1.)*.55+.15;
float wR=max(clamp((sl-.2+(nz-.5)*.1)*5.,0.,1.),clamp((hh-62.)/14.,0.,1.)*.85),wS=1.-smoothstep(2.3,3.7,hh+(nz-.5)*.9),wD=smoothstep(.56,.72,n3(vW*.045+7.3)*.7+nz*.3+sl*.6)*(1.-wS);
vec3 alb=vec3(0.),a;vec2 tn=vec2(0.),t;float r=0.,q,wG=(1.-wD)*(1.-wS);
if(wG>.01){top(0,vW,uTL[0].x,far,a,t,q);alb+=tnt(a,base,uTA[0],uTL[0].z)*wG*.82;tn+=t*wG;r+=q*wG;}
if(wD*(1.-wS)>.01){float w=wD*(1.-wS);top(1,vW,uTL[1].x,far,a,t,q);alb+=tnt(a,base,uTA[1],uTL[1].z)*w;tn+=t*w;r+=q*w;}
if(wS>.01){top(2,vW,uTL[2].x,far,a,t,q);alb+=tnt(a,base,uTA[2],uTL[2].z)*wS;tn+=t*wS;r+=q*wS;}
vec3 nn=normalize(vec3(Ng.x+tn.x*.9,Ng.y,Ng.z+tn.y*.9));
if(wR>.01){vec3 ra,rn;float rr;tri(3,vW,Ng,uTL[3].x,ra,rn,rr);ra=tnt(mix(ra,sD(3,vW.xz*uTL[3].x*.21).rgb,far*.6),base,uTA[3],uTL[3].z);alb=mix(alb,ra,wR);nn=normalize(mix(nn,rn,wR));r=mix(r,rr,wR);}
float sn=clamp((hh-108.)/10.,0.,1.)*(1.-wR*.7);alb=mix(alb,vec3(.92,.94,.97),sn);r=mix(r,.55,sn);
base=mix(base,alb,tf);N=normalize(mix(Ng,nn,tf));rough=mix(rough,r,tf);}
else if(vLq.x>-.5){int l=int(vLq.x+.5);vec3 a,nn;float r;tri(l,vT,normalize(vTN),vLq.y,a,nn,r);if(uLoc>.5)nn=normalize(uNM*nn);if(dot(nn,Ng)<0.)nn=-nn;
if(vLq.z>.01){a=vec3(dot(a,vec3(.3,.59,.11)))/dot(vAvg,vec3(.3,.59,.11));base=mix(base,base*mix(vec3(1.),a,.85),tf);}else base=mix(base,tnt(a,base,vAvg,vLq.w),tf);
N=normalize(mix(Ng,nn,tf));rough=mix(rough,r,tf);if(vLq.z<0.)skin=1.;else metal=vLq.z*tf;}
}
rough=clamp(mix(rough,.28,uWet*.7),.06,1.);
float sh=shadowAt(vW,Ng);float NL=max(dot(N,uSun),0.),NV=max(dot(N,V),.001);float d=NL*sh;float hemi=.5+.5*N.y;vec3 amb=mix(uGndC,uSkyC,hemi);
vec3 H=normalize(uSun+V);float NH=max(dot(N,H),0.),VH=max(dot(V,H),0.),a2=rough*rough;a2*=a2;float dn=NH*NH*(a2-1.)+1.,D=a2/(dn*dn+1e-5),kk=(rough+1.)*(rough+1.)*.125;
float G=(NL/(NL*(1.-kk)+kk))*(NV/(NV*(1.-kk)+kk));vec3 F0=mix(vec3(.04),base,metal),F=F0+(1.-F0)*pow(1.-VH,5.);
vec3 spc=min(D*G*F/(4.*NL*NV+.001),vec3(6.))*NL*sh*uSunC;
vec3 R=reflect(-V,N);vec3 env=mix(uGndC,uSkyC,clamp(R.y*.5+.5,0.,1.));env=mix(env,vec3(dot(env,vec3(.3,.59,.11))),.65)*(1.+metal*.9);spc+=env*(F0+(max(vec3(1.-rough),F0)-F0)*pow(1.-NV,5.))*(1.-rough*.55)*(.55+.45*sh);
float sp=0.;float rim=pow(1.-NV,3.)*(1.-metal);
vec3 lit=amb*(.72+.18*sh)+d*uSunC;if(lf>.5)lit+=uSunC*(pow(max(dot(-V,uSun),0.),4.)*.55+.1*max(uSun.y,0.))*sh;
if(skin>.5){float wr=max((dot(N,uSun)+.4)/1.4,0.);lit+=vec3(.55,.16,.1)*(wr-NL)*sh*uSunC;}
base*=1.-metal*.55;
#else
float sh=shadowAt(vW,N);float d=max(dot(N,uSun),0.)*sh;float hemi=.5+.5*N.y;vec3 amb=mix(uGndC,uSkyC,hemi);
vec3 H=normalize(uSun+V);float sp=pow(max(dot(N,H),0.),mix(24.,90.,uWet))*(.08+uWet*.5)*sh;
float rim=pow(1.-max(dot(N,V),0.),3.);
vec3 lit=amb*(.72+.18*sh)+d*uSunC;if(lf>.5)lit+=uSunC*(pow(max(dot(-V,uSun),0.),4.)*.55+.1*max(uSun.y,0.))*sh;
#endif
for(int i=0;i<${MAX_LIGHTS};i++){vec3 L=uLP[i]-vW;float r=length(L);float a=uLC[i].a;if(a>0.){float att=a*.55/(1.+r*r*.16)*clamp(1.-r/(a*3.+4.),0.,1.);lit+=uLC[i].rgb*att*(.35+.65*max(dot(N,L/r),0.));}}
vec3 col=base*lit+sp*uSunC+rim*uSkyC*.12;
#ifdef TEX
col+=spc;
#endif
col=mix(col,base*1.8,clamp(e,0.,1.));
float dist=length(uEye-vW);float f=clamp((dist-uFog.x)/(uFog.y-uFog.x),0.,1.);
float hf=exp(-max(vW.y-uFogH,0.)*.025)*clamp(dist/250.,0.,1.)*.35;f=clamp(max(f*f*(3.-2.*f),hf),0.,1.);
col=mix(col,uFogC,f);
gl_FragColor=vec4(col,uA>0.?uA:clamp(e,0.,1.)*(1.-f));}`;
const FS_MESH = fsMesh(false), FS_MESH_TEX = fsMesh(true);
const VS_INST = `attribute vec3 aP;attribute vec3 aN;attribute vec4 aC;attribute vec4 aI;attribute float aS;
uniform mat4 uVP;uniform float uTime,uWind;varying vec3 vN,vW;varying vec4 vC;
uniform float uMatL[8],uLocal;uniform vec4 uLay[5];uniform vec3 uAvg[5];varying vec3 vT,vTN,vAvg;varying vec4 vLq;
varying vec3 vUV;
float fwa(){return aC.a<-19.5?(aC.b>0.?-1.-aC.b:0.):aC.a<-9.?aC.a+10.:aC.a;}
vec3 fnl(){return aC.a<-19.5?aN:aC.a<-9.?(aN.z<-900.?vec3(0.,1.,0.):normalize(vec3(aP.x,(aP.y-aN.z)*.8,aP.z)+vec3(0.,.02,0.))):aN;}
void matv(vec3 lp,vec3 ln){bool tx=aC.a<-19.5;vUV=tx?vec3(aC.rg,aC.a<-20.5?3.:2.):aC.a<-9.?vec3(aN.xy,1.):vec3(0.);float mt=aC.a>=0.?floor(aC.a*.5+.001):0.;vC=tx?vec4(1.,1.,1.,0.):vec4(aC.rgb,aC.a>=0.?aC.a-2.*mt:fwa());float l=tx?-1.:uMatL[int(mt)];int li=int(max(l,0.)+.5);
vLq=vec4(l,uLay[li].xyz);vAvg=uAvg[li];if(uLocal>.5){vT=lp;vTN=ln;}else{vT=vW;vTN=vN;}}
void main(){float c=cos(aI.w),s=sin(aI.w);vec3 p=aP*aS;vec4 w=vec4(aI.xyz+vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c),1.);
float fa=fwa();if(fa<-.5){float k=-fa-1.;w.x+=sin(uTime*1.6+w.z*.21+w.x*.13)*k*uWind;w.z+=cos(uTime*1.3+w.x*.17)*k*uWind*.6;}
vec3 nl=fnl();vW=w.xyz;vN=normalize(vec3(nl.x*c+nl.z*s,nl.y,-nl.x*s+nl.z*c));matv(w.xyz,vN);gl_Position=uVP*w;}`;
const VS_DEPTH = `attribute vec3 aP;attribute vec3 aN;attribute vec4 aC;uniform mat4 uLVP,uM;uniform float uTime,uWind;varying vec3 vUV;
void main(){vec4 w=uM*vec4(aP,1.);bool tx=aC.a<-19.5;float fa=tx?(aC.b>0.?-1.-aC.b:0.):aC.a<-9.?aC.a+10.:aC.a;vUV=tx?vec3(aC.rg,2.):aC.a<-9.?vec3(aN.xy,1.):vec3(0.);if(fa<-.5){float k=-fa-1.;w.x+=sin(uTime*1.6+w.z*.21+w.x*.13)*k*uWind;w.z+=cos(uTime*1.3+w.x*.17)*k*uWind*.6;}gl_Position=uLVP*w;}`;
const FS_DEPTH = P_HI + `varying vec3 vUV;uniform sampler2D uLeaf,uMod;void main(){if(vUV.z>1.5){if(texture2D(uMod,vUV.xy).a<.4)discard;}else if(vUV.z>.5&&texture2D(uLeaf,vUV.xy).a<.38)discard;vec4 r=fract(gl_FragCoord.z*vec4(16777216.,65536.,256.,1.));r-=r.xxyz*vec4(0.,1./256.,1./256.,1./256.);gl_FragColor=r;}`;
const VS_FS = `attribute vec2 aP;varying vec2 vU;void main(){vU=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}`;
const FS_SKY = P_HI + `varying vec2 vU;uniform mat4 uIVP;uniform vec3 uTop,uHor,uBot,uSun,uSunC,uMoon,uEye,uFogC;uniform float uTime,uStars,uCloud,uCloudD;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p*=2.07;a*=.5;}return s;}
void main(){vec4 a=uIVP*vec4(vU*2.-1.,1.,1.);vec3 D=normalize(a.xyz/a.w-uEye);
float y=D.y;vec3 c=y>0.?mix(uHor,uTop,pow(clamp(y,0.,1.),.5)):mix(uHor,uBot,pow(clamp(-y,0.,1.),.35));
float sd=max(dot(D,uSun),0.);c+=uSunC*(smoothstep(.99965,.9999,sd)*5.*step(-.05,uSun.y)+pow(sd,60.)*.35+pow(sd,6.)*.08)*(1.-uCloud*.6);
float md=max(dot(D,uMoon),0.);float moon=smoothstep(.9994,.9997,md);
if(y>0.){if(uStars>0.){vec2 sp=D.xz/(y+.35)*110.;float st=step(.9965,h(floor(sp)))*smoothstep(.0,.3,y)*uStars*(.55+.45*sin(uTime*2.+h(floor(sp))*40.));c+=vec3(st)*(1.-uCloud);}
c+=vec3(.85,.88,.95)*moon*uStars*1.2;c+=vec3(.25,.3,.4)*pow(md,60.)*uStars*.5;
vec2 cp=D.xz/(y+.1)*1.3+vec2(uTime*.006,uTime*.002);float n=fb(cp);float cl=smoothstep(.62-uCloud*.45,.95-uCloud*.25,n);
vec3 cc=mix(uHor*1.05,mix(vec3(1.),uSunC,.35)*(.55+.5*max(uSun.y,0.)),.45+.4*sd);cc=mix(cc,uHor*.45,uCloudD);
c=mix(c,cc,cl*smoothstep(0.,.18,y)*.88);}
c=mix(c,uFogC,(1.-smoothstep(-.02,.14,y))*.92);
gl_FragColor=vec4(c,smoothstep(.9996,.9999,sd)*.7*step(0.,uSun.y));}`;
// water: tessellated grid around the camera, depth from terrain height texture
const VS_WATER = `attribute vec2 aP;uniform mat4 uVP;uniform vec3 uEye;uniform float uY,uTime,uExt,uWaveH;varying vec3 vW;varying float vWv;
vec3 gw(vec2 p,vec2 d,float L,float A,float sp){float k=6.2831/L;float f=k*(dot(d,p)-sp*uTime);return vec3(d.x*A*.6*cos(f),A*sin(f),d.y*A*.6*cos(f));}
void main(){vec2 snap=floor(uEye.xz/8.)*8.;float r=length(aP);vec2 q=aP*uExt*(r*r*.9+.1*r);vec3 w=vec3(q.x+snap.x,uY,q.y+snap.y);
vec3 o=gw(w.xz,normalize(vec2(1.,.3)),31.,.32,3.2)+gw(w.xz,normalize(vec2(-.4,1.)),17.,.16,2.4)+gw(w.xz,normalize(vec2(.7,-.6)),9.,.07,1.8)+gw(w.xz,normalize(vec2(-.9,-.2)),5.,.035,1.2);
float fade=clamp(1.-length(w.xz-uEye.xz)/700.,0.,1.);w+=o*uWaveH*fade;vWv=o.y*uWaveH;vW=w;gl_Position=uVP*vec4(w,1.);}`;
const FS_WATER = P_HI + `varying vec3 vW;varying float vWv;uniform vec3 uEye,uSun,uSunC,uSkyC,uHor,uFogC,uShal,uDeep;uniform vec2 uFog;uniform float uTime,uY,uWS,uHmin,uHmax,uRain,uWaveH;uniform sampler2D uH;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float terr(vec2 xz){vec2 uv=xz/uWS+.5;if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)return uHmin;vec4 t=texture2D(uH,uv);return uHmin+(t.r*255.*256.+t.g*255.)/65535.*(uHmax-uHmin);}
float hgt(vec2 p){float t=uTime;return n2(p*.9+vec2(t*.35,t*.21))*.5+n2(p*2.1-vec2(t*.28,-t*.33))*.28+n2(p*4.7+vec2(-t*.6,t*.47))*.14+n2(p*11.+vec2(t*1.3,-t))*.08*(1.+uRain*2.);}
void main(){float depth=max(uY-terr(vW.xz),0.);vec2 p=vW.xz*.42;float dist=length(uEye-vW);float e=.04;
float c0=hgt(p),cx=hgt(p+vec2(e,0.)),cz=hgt(p+vec2(0.,e));float str=mix(1.1,.35,clamp(dist/180.,0.,1.));
vec3 N=normalize(vec3((c0-cx)/e*.12*str,1.,(c0-cz)/e*.12*str));vec3 V=normalize(uEye-vW);
float fr=.02+.98*pow(1.-max(dot(N,V),0.),5.);
vec3 R=reflect(-V,N);R.y=abs(R.y);vec3 sky=mix(uHor*1.05,uSkyC*1.15,pow(clamp(R.y,0.,1.),.6));
float k=1.-exp(-depth*.28);vec3 body=mix(uShal*1.15,uDeep,k);
float sss=pow(max(dot(V,-uSun),0.),3.)*clamp(vWv*2.+.4,0.,1.)*max(uSun.y,0.);body+=uShal*sss*1.4;
float diff=max(dot(N,uSun),0.)*.25+.75;vec3 col=mix(body*diff,sky,clamp(fr,0.,.9));
float sp=pow(max(dot(R,uSun),0.),400.)*6.+pow(max(dot(R,uSun),0.),40.)*.3;col+=uSunC*sp*step(0.,uSun.y);
float sh=smoothstep(1.6,0.,depth),band=sin(depth*7.-uTime*1.8+n2(vW.xz*.7)*5.)*.5+.5;float foam=sh*(.35+.65*band)*smoothstep(.25,.75,n2(vW.xz*3.+uTime*.3));
foam+=smoothstep(.22,.42,vWv)*n2(vW.xz*2.5-uTime*.5)*.6;col=mix(col,vec3(.93,.95,.96)*(.55+.45*max(uSun.y,.15)),clamp(foam,0.,1.)*.8);
float f=clamp((dist-uFog.x)/(uFog.y-uFog.x),0.,1.);col=mix(col,uFogC,f*f*(3.-2.*f));
float a=clamp(.42+k*.58+fr*.35,0.,1.);a=mix(a,1.,f);a*=smoothstep(0.,.12,depth);
gl_FragColor=vec4(col,a);}`;
// rain: GPU streaks, recycled around the camera
const VS_RAIN = `attribute vec3 aP;uniform mat4 uVP;uniform vec3 uEye,uWindV;uniform float uTime,uLen;varying float vA;
void main(){float top=step(1.5,aP.y);float ph=fract(aP.y);float fall=fract(ph-uTime*.9*(1.+fract(aP.x*7.31)*.35));
vec3 w=uEye+vec3(aP.x*44.-22.,fall*26.-9.,aP.z*44.-22.);w.y+=top*uLen;w.xz-=top*uWindV.xz*.07;
vA=.07+.2*top;gl_Position=uVP*vec4(w,1.);}`;
const FS_RAIN = P_HI + `varying float vA;uniform vec3 uC;uniform float uI;void main(){gl_FragColor=vec4(uC*vA*uI,vA*uI);}`;
const VS_PART = `attribute vec3 aP;attribute vec3 aQ;attribute vec4 aC;uniform mat4 uVP;uniform vec3 uR,uU;varying vec4 vC;varying vec2 vQ;
void main(){vC=aC;vQ=aQ.xy;vec3 w=aP+(uR*aQ.x+uU*aQ.y)*aQ.z;gl_Position=uVP*vec4(w,1.);}`;
const FS_PART = P_HI + `varying vec4 vC;varying vec2 vQ;uniform float uSoft,uTm;
float ph(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float pn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(ph(i),ph(i+vec2(1,0)),f.x),mix(ph(i+vec2(0,1)),ph(i+vec2(1,1)),f.x),f.y);}
void main(){if(uSoft>1.5){float sd=fract(vC.r*91.7+vC.g*37.3+vC.b*13.1);vec2 q=vQ;float n=pn(q*2.4+vec2(sd*7.,sd*11.-uTm*3.2))*.6+pn(q*5.2+vec2(sd*3.,-uTm*5.5))*.4;
q.x*=1.25+(q.y+1.)*.55;float r=length(vec2(q.x,q.y*.82+.16))+(n-.5)*.6*(q.y*.5+.85);float a=smoothstep(1.,.2,r)*smoothstep(1.,.78,max(abs(vQ.x),abs(vQ.y)));
vec3 c=mix(vC.rgb,vec3(1.,.9,.6),smoothstep(.5,.05,r)*.7);gl_FragColor=vec4(c*vC.a*a*.62,vC.a*a*.35);return;}
float r=length(vQ);float a=uSoft>0.?smoothstep(1.,0.,r):step(r,1.)*(1.-r*r);a=a*a;gl_FragColor=vec4(vC.rgb*vC.a*a,vC.a*a);}`;
const FS_BRIGHT = P_HI + `varying vec2 vU;uniform sampler2D uT;uniform vec2 uPx;void main(){vec3 s=vec3(0.);
for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){vec4 c=texture2D(uT,vU+vec2(float(i),float(j))*uPx);float l=dot(c.rgb,vec3(.3,.59,.11));s+=c.rgb*(c.a*1.1+smoothstep(.8,1.,l)*.5);}gl_FragColor=vec4(s/9.,1.);}`;
const FS_BLUR = P_HI + `varying vec2 vU;uniform sampler2D uT;uniform vec2 uD;void main(){vec3 c=texture2D(uT,vU).rgb*.227;
c+=(texture2D(uT,vU+uD*1.384).rgb+texture2D(uT,vU-uD*1.384).rgb)*.316;c+=(texture2D(uT,vU+uD*3.23).rgb+texture2D(uT,vU-uD*3.23).rgb)*.07;gl_FragColor=vec4(c,1.);}`;
const FS_COMP = P_HI + `varying vec2 vU;uniform sampler2D uT,uB;uniform float uBloom,uVig,uSat,uCon,uFlash,uHurt,uTimeC,uExp,uFxaa;uniform vec3 uGrade,uFlashC,uLift;uniform vec2 uPx;
const vec3 LW=vec3(.299,.587,.114);
vec3 fxaa(vec3 m){vec3 nw=texture2D(uT,vU+vec2(-1.,-1.)*uPx).rgb,ne=texture2D(uT,vU+vec2(1.,-1.)*uPx).rgb,sw=texture2D(uT,vU+vec2(-1.,1.)*uPx).rgb,se=texture2D(uT,vU+vec2(1.,1.)*uPx).rgb;
float lnw=dot(nw,LW),lne=dot(ne,LW),lsw=dot(sw,LW),lse=dot(se,LW),lm=dot(m,LW),lmin=min(lm,min(min(lnw,lne),min(lsw,lse))),lmax=max(lm,max(max(lnw,lne),max(lsw,lse)));
if(lmax-lmin<max(.03,lmax*.11))return m;
vec2 d=vec2(-((lnw+lne)-(lsw+lse)),(lnw+lsw)-(lne+lse));float rd=max((lnw+lne+lsw+lse)*.03125,.0078125),rm=1./(min(abs(d.x),abs(d.y))+rd);d=clamp(d*rm,-8.,8.)*uPx;
vec3 a=.5*(texture2D(uT,vU+d*(1./3.-.5)).rgb+texture2D(uT,vU+d*(2./3.-.5)).rgb),b=a*.5+.25*(texture2D(uT,vU-d*.5).rgb+texture2D(uT,vU+d*.5).rgb);float lb=dot(b,LW);return(lb<lmin||lb>lmax)?a:b;}
void main(){vec2 c=vU-.5;vec3 col=texture2D(uT,vU).rgb;if(uFxaa>.5)col=fxaa(col);
col+=texture2D(uB,vU).rgb*uBloom;col*=uGrade*uExp;col+=uLift;float l=dot(col,vec3(.3,.59,.11));col=mix(vec3(l),col,uSat);col=(col-.5)*uCon+.5;
col=clamp((col*(2.51*col+.03))/(col*(2.43*col+.59)+.14),0.,1.);col=pow(col,vec3(1.08));float v=dot(c,c);col*=1.-v*uVig;col=mix(col,vec3(.55,.03,.02),uHurt*smoothstep(.08,.5,v));col=mix(col,uFlashC,uFlash);
float g=fract(sin(dot(vU*uTimeC,vec2(12.9898,78.233)))*43758.5453);col+=(g-.5)*.018;gl_FragColor=vec4(clamp(col,0.,1.),1.);}`;

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
    const opts = { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); if (gl) gl.getExtension('OES_standard_derivatives');   // must be on before the shaders compile: normal maps of the textured models
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;
    this.P = {
      mesh: prog(gl, VS_MESH, FS_MESH, ['aP', 'aN', 'aC']),
      inst: prog(gl, VS_INST, FS_MESH, ['aP', 'aN', 'aC', 'aI', 'aS']),
      sky: prog(gl, VS_FS, FS_SKY, ['aP']),
      water: prog(gl, VS_WATER, FS_WATER, ['aP']),
      rain: prog(gl, VS_RAIN, FS_RAIN, ['aP']),
      part: prog(gl, VS_PART, FS_PART, ['aP', 'aQ', 'aC']),
      bright: prog(gl, VS_FS, FS_BRIGHT, ['aP']),
      blur: prog(gl, VS_FS, FS_BLUR, ['aP']),
      comp: prog(gl, VS_FS, FS_COMP, ['aP']),
      depth: prog(gl, VS_DEPTH, FS_DEPTH, ['aP', 'aN', 'aC'])
    };
    this.smSize = 0; this.shadowOn = 0;
    this.instExt = gl.getExtension('ANGLE_instanced_arrays'); this.iBuf = gl.createBuffer();
    this.tex = new TextureBank(gl); this.texOn = false; this.texSetName = 'world'; this._sv = 1; this._nm = new Float32Array(9);
    this.fsq = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.fsq); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.buildWaterGrid(); this.buildRain(3000);
    this.pBuf = gl.createBuffer(); this.pData = new Float32Array(6 * 10 * 6000);
    this.q = { scale: 1, bloom: true, maxDpr: 1.5 };
    this.env = null; this.fx = { flash: 0, flashC: [1, 1, 1], hurt: 0 };
    this.lights = new Float32Array(MAX_LIGHTS * 3); this.lightC = new Float32Array(MAX_LIGHTS * 4);
    this.time = 0; this.stats = { draws: 0, tris: 0 }; this.near = 0.1; this.far = 1400;
    this.resize();
  }
  buildWaterGrid() {
    const gl = this.gl, N = 96, v = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) v.push(i / N * 2 - 1, j / N * 2 - 1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    this.wBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.wBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    this.wIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW); this.wN = idx.length;
  }
  buildRain(n) {
    const gl = this.gl, v = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = Math.random(), y = Math.random() * 0.999, z = Math.random(); v.set([x, y, z, x, y + 2, z], i * 6); }
    this.rBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.rBuf); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW); this.rN = n * 2;
  }
  /** 1x1 white texture bound to every unused unit: an unset sampler defaults to unit 0, which still holds last frame's
   *  scene texture -> 'feedback loop formed between framebuffer and texture' -> the draw is dropped (empty map). */
  get PM() { return this.texOn ? this.P.meshT : this.P.mesh; }
  get PI() { return this.texOn ? this.P.instT : this.P.inst; }
  /** surface textures: 0 off · 1 → 1K · 2 → 2K. The textured shaders are compiled the first time they are needed. */
  async setTextures(res) {
    const gl = this.gl; if (!res) { this.texOn = false; this.tex.free(); return false; }
    const ok = await this.tex.load(res); if (!ok) { this.texOn = false; return false; }
    if (!this.P.meshT) { try { this.P.meshT = prog(gl, VS_MESH, FS_MESH_TEX, ['aP', 'aN', 'aC']); this.P.instT = prog(gl, VS_INST, FS_MESH_TEX, ['aP', 'aN', 'aC', 'aI', 'aS']); } catch (e) { console.warn('ARVEX textured shader: ' + e.message); this.tex.supported = false; this.P.meshT = null; this.texOn = false; return false; } }
    this._sv++; this.texOn = true; return true;
  }
  /** atlas of the textured models made in Blender from real scans (tools/blender/arvex_tx.py): albedo+alpha, and normal.xy + roughness + metalness */
  loadModelAtlas(url, urlN) {
    const gl = this.gl; gl.getExtension('OES_standard_derivatives');
    const one = (u, key, rep) => { const im = new Image(); im.onload = () => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const af = this.aniso || (this.aniso = gl.getExtension('EXT_texture_filter_anisotropic')); if (af) gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); this[key] = t; }; im.onerror = () => console.warn('ARVEX model atlas missing', u); im.src = u; };
    one(url, 'modTex'); if (urlN) one(urlN, 'modNTex');
  }
  /** bind the model atlases on units 14/15 for the program P (flat normal / mid roughness until they have loaded) */
  bindModelAtlas(P) { const gl = this.gl; if (P.u.uMod == null && P.u.uModN == null) return;
    if (!this._flatN) { this._flatN = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._flatN); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 200, 0])); }
    gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, this.modTex || this.dummyTex()); if (P.u.uMod != null) gl.uniform1i(P.u.uMod, 14);
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, this.modNTex || this._flatN); if (P.u.uModN != null) gl.uniform1i(P.u.uModN, 15); gl.activeTexture(gl.TEXTURE0); }
  /** alpha-cut foliage atlas (leaf clusters, conifer branch, grass tuft): always loaded, textures setting or not */
  loadFoliage(url = 'textures/foliage.png') {
    const gl = this.gl, im = new Image(); im.onload = () => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); this.leafTex = t; };
    im.onerror = () => console.warn('ARVEX foliage atlas missing'); im.src = url;
  }
  /** choose which five layers are bound: 'terrain' | 'world' | 'char' */
  texSet(name) {
    if (!this.texOn || name === this.texSetName && this._bound === this.tex.res) return; this.texSetName = name; this._bound = this.tex.res; this._sv++;
    const gl = this.gl, set = TEX_SETS[name]; for (let i = 0; i < 5; i++) { const t = this.tex.tex[set[i][0]]; gl.activeTexture(gl.TEXTURE4 + i); gl.bindTexture(gl.TEXTURE_2D, t.d); gl.activeTexture(gl.TEXTURE9 + i); gl.bindTexture(gl.TEXTURE_2D, t.n); } gl.activeTexture(gl.TEXTURE0);
  }
  setTexUniforms(P, local) {
    const gl = this.gl, set = TEX_SETS[this.texSetName], ml = new Float32Array(8).fill(-1), lay = new Float32Array(20), avg = new Float32Array(15);
    set.forEach(([n, sc, me, ti], i) => { const id = MAT_LAYER.indexOf(n); if (id > 0) ml[id] = i; lay.set([sc, me, ti, 0], i * 4); avg.set(TEX_LAYERS[n], i * 3); });
    gl.uniform1fv(P.u.uMatL, ml); gl.uniform4fv(P.u.uLay, lay); gl.uniform3fv(P.u.uAvg, avg); gl.uniform4fv(P.u.uTL, lay.subarray(0, 16)); gl.uniform3fv(P.u.uTA, avg.subarray(0, 12));
    for (let i = 0; i < 5; i++) { gl.uniform1i(P.u['uD' + i], 4 + i); gl.uniform1i(P.u['uN' + i], 9 + i); }
    gl.uniform1f(P.u.uTexD, this.q.texDist || 120); gl.uniform1f(P.u.uTerr, 0); gl.uniform1f(P.u.uLocal, local); gl.uniform1f(P.u.uLoc, local); P._terr = 0; P._sv = this._sv;
  }
  dummyTex() {
    const gl = this.gl;
    if (!this._dummy) { this._dummy = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this._dummy); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255])); }
    return this._dummy;
  }
  unbindUnits() { const gl = this.gl, d = this.dummyTex(); for (let i = 3; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, d); } }
  setQuality(q) { if (q.targetH !== this.q.targetH || q.scale !== this.q.scale) this.safeScale = 1; Object.assign(this.q, q); this.resize(); }
  /** what this GPU can do: its name (when the browser exposes it) and the largest render target it accepts */
  probe() {
    const gl = this.gl, dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || 'unknown');
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [4096, 4096];
    this.maxDim = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, vp[0], vp[1]);
  }
  /** internal render size. targetH (1080…4320) renders at that height whatever the window size (super-sampling above the
   *  display resolution); otherwise the window size × device pixel ratio × render scale. Always clamped to what the GPU accepts. */
  resize() {
    const gl = this.gl, dpr = Math.min(window.devicePixelRatio || 1, this.q.maxDpr); if (!this.maxDim) this.probe();
    const cw = Math.max(2, this.cv.clientWidth), ch = Math.max(2, this.cv.clientHeight);
    let w = this.q.targetH ? Math.round(this.q.targetH * cw / ch) : Math.floor(cw * dpr * this.q.scale), h = this.q.targetH ? this.q.targetH : Math.floor(ch * dpr * this.q.scale);
    const MAX_PIXELS = 7680 * 4320, k = Math.min(1, this.maxDim / w, this.maxDim / h, Math.sqrt(MAX_PIXELS / (w * h)), this.safeScale || 1);
    this.capped = k < 0.999; if (this.capped) { w = Math.floor(w * k); h = Math.floor(h * k); }
    w = Math.max(2, w); h = Math.max(2, h);
    if (w === this.w && h === this.h && this.fbo) return;
    this.cv.width = w; this.cv.height = h; this.w = w; this.h = h;
    const mk = (W, H, depth) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      let r = null;
      if (depth) { // 24-bit depth via DEPTH_STENCIL (guaranteed in WebGL1); fall back to 16-bit
        r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, W, H); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, r);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, r); }
      }
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f, r, W, H, ok };
    };
    for (const k of ['fbo', 'b1', 'b2']) if (this[k]) { gl.deleteTexture(this[k].t); gl.deleteFramebuffer(this[k].f); if (this[k].r) gl.deleteRenderbuffer(this[k].r); }
    this.fbo = mk(w, h, true);
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.b1 = mk(bw, bh, false); this.b2 = mk(bw, bh, false);
    this.post = this.fbo.ok;
    // a render target the driver refuses (out of memory at 6K/8K) must never leave a black screen: step down and try again
    if ((!this.fbo.ok || gl.getError() === gl.OUT_OF_MEMORY) && (this.safeScale || 1) > 0.2) { this.safeScale = (this.safeScale || 1) * 0.75; this.w = 0; return this.resize(); }
  }
  /** terrain heights for the water shader. heights: Float32Array size*size covering worldSize metres centred on 0 */
  setHeightTex(heights, size, worldSize, hmin, hmax) {
    const gl = this.gl, d = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) { const v = Math.round(Math.max(0, Math.min(1, (heights[i] - hmin) / (hmax - hmin))) * 65535); d[i * 4] = v >> 8; d[i * 4 + 1] = v & 255; d[i * 4 + 3] = 255; }
    if (!this.hTex) this.hTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.hTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hInfo = { worldSize, hmin, hmax };
  }
  upload(mb) {
    if (!mb) return null;
    if (Array.isArray(mb)) return { multi: mb.map(x => this.upload(x)).filter(Boolean) };
    const gl = this.gl, b = gl.createBuffer(), arr = mb instanceof Float32Array ? mb : mb.v instanceof Float32Array ? mb.v : new Float32Array(mb.v);
    if (!arr.length) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    const m = { b, n: arr.length / 10 };
    if (mb.i && mb.i.length) {
      m.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mb.i instanceof Uint16Array ? mb.i : new Uint16Array(mb.i), gl.STATIC_DRAW);
      m.ni = mb.i.length;
    }
    return m;
  }
  free(m) {
    if (!m) return;
    if (m.multi) { for (const x of m.multi) this.free(x); return; }
    if (m.b) this.gl.deleteBuffer(m.b); if (m.ib) this.gl.deleteBuffer(m.ib);
  }
  setEnv(env) { this.env = env; }
  setLights(list) { // [{p:[x,y,z], c:[r,g,b], r:radius}]
    this.lights.fill(0); this.lightC.fill(0);
    for (let i = 0; i < Math.min(list.length, MAX_LIGHTS); i++) { const L = list[i]; this.lights.set(L.p, i * 3); this.lightC.set([L.c[0], L.c[1], L.c[2], L.r], i * 4); }
  }
  camera(eye, target, fovy, up = [0, 1, 0], near = 0.1, far = 1400) {
    this.eye = eye; this.view = lookAt(eye, target, up); this.fovy = fovy; this.near = near; this.far = far;
    this.proj = perspective(fovy, this.w / this.h, near, far); this.vp = mul(this.proj, this.view);
    const f = norm(sub(target, eye)); this.camR = norm(cross(f, up)); this.camU = cross(this.camR, f); this.camF = f;
  }
  begin() {
    const gl = this.gl, E = this.env; this.stats.draws = 0; this.stats.tris = 0; this.frameId = (this.frameId || 0) + 1;
    this.unbindUnits();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.post ? this.fbo.f : null); gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    const S = this.P.sky; gl.useProgram(S.p);
    gl.uniformMatrix4fv(S.u.uIVP, false, invert(this.vp)); gl.uniform3fv(S.u.uTop, E.skyTop); gl.uniform3fv(S.u.uHor, E.skyHor); gl.uniform3fv(S.u.uBot, E.skyBot);
    gl.uniform3fv(S.u.uSun, E.sunDir || E.sun); gl.uniform3fv(S.u.uSunC, E.sunC); gl.uniform3fv(S.u.uMoon, E.moon || [0, -1, 0]); gl.uniform3fv(S.u.uEye, this.eye); gl.uniform1f(S.u.uTime, this.time);
    gl.uniform1f(S.u.uStars, E.stars || 0); gl.uniform3fv(S.u.uFogC, E.fogC); gl.uniform1f(S.u.uCloud, E.cloud || 0.3); gl.uniform1f(S.u.uCloudD, E.cloudDark || 0);
    this.fs(S);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    this.useMesh();
  }
  useMesh(vp) {
    const gl = this.gl, E = this.env, M = this.PM; gl.useProgram(M.p); if (this.texOn && M._sv !== this._sv) this.setTexUniforms(M, 1);
    gl.uniformMatrix4fv(M.u.uVP, false, vp || this.vp); gl.uniform3fv(M.u.uSun, E.sun); gl.uniform3fv(M.u.uSunC, E.sunC); gl.uniform3fv(M.u.uSkyC, E.amb); gl.uniform3fv(M.u.uGndC, E.gnd);
    gl.uniform3fv(M.u.uFogC, E.fogC); gl.uniform2f(M.u.uFog, E.fogN, E.fogF); gl.uniform3fv(M.u.uEye, this.eye); gl.uniform1f(M.u.uTime, this.time); gl.uniform1f(M.u.uWind, E.wind || 0.3);
    gl.uniform1f(M.u.uWet, E.wet || 0); gl.uniform1f(M.u.uFogH, E.fogH == null ? 0 : E.fogH);
    gl.uniform3fv(M.u.uLP, this.lights); gl.uniform4fv(M.u.uLC, this.lightC);
    gl.uniform1f(M.u.uSOn, this.shadowOn && this.smTex ? this.shadowOn : 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.smTex || this.dummyTex()); gl.uniform1i(M.u.uSM, 2); gl.uniformMatrix4fv(M.u.uLVP, false, this.lvp || ID16); gl.uniform1f(M.u.uSMs, this.smSize || 1024); gl.activeTexture(gl.TEXTURE0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.leafTex || this.dummyTex()); gl.uniform1i(M.u.uLeaf, 3); gl.activeTexture(gl.TEXTURE0); this.bindModelAtlas(M);
    gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2); gl.disable(gl.CULL_FACE);
  }
  draw(mesh, M, o) {
    if (mesh && mesh.multi) { for (const x of mesh.multi) this.draw(x, M, o); return; }
    if (!mesh || !mesh.n) return;
    const gl = this.gl, P = this.PM;
    gl.uniformMatrix4fv(P.u.uM, false, M);
    if (this.texOn) { if (P._sv !== this._sv) this.setTexUniforms(P, 1); const terr = o && o.terrain ? 1 : 0; if (terr !== P._terr) { P._terr = terr; gl.uniform1f(P.u.uTerr, terr); gl.uniform1f(P.u.uLocal, 1 - terr); gl.uniform1f(P.u.uLoc, 1 - terr); }
      if (!terr) { const n = this._nm; n[0] = M[0]; n[1] = M[1]; n[2] = M[2]; n[3] = M[4]; n[4] = M[5]; n[5] = M[6]; n[6] = M[8]; n[7] = M[9]; n[8] = M[10]; gl.uniformMatrix3fv(P.u.uNM, false, n); } }
    gl.uniform4fv(P.u.uTint, o && o.tint ? o.tint : ZERO4); gl.uniform1f(P.u.uEmit, o && o.emit || 0); gl.uniform1f(P.u.uA, o && o.alpha || 0); gl.uniform1f(P.u.uDetail, o && o.detail || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.b);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    if (mesh.ib) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib); gl.drawElements(gl.TRIANGLES, mesh.ni, gl.UNSIGNED_SHORT, 0); this.stats.tris += mesh.ni / 3; }
    else { gl.drawArrays(gl.TRIANGLES, 0, mesh.n); this.stats.tris += mesh.n / 3; }
    this.stats.draws++;
  }
  /** GPU instancing: one model, many placements. inst = Float32Array of [x,y,z,yaw,scale] per instance */
  drawInstanced(mesh, inst, count, o) {
    if (!mesh || !mesh.n || !count) return;
    const gl = this.gl, X = this.instExt;
    if (!X) { for (let i = 0; i < count; i++) { const k = i * 5, c = Math.cos(inst[k + 3]) * inst[k + 4], s = Math.sin(inst[k + 3]) * inst[k + 4], sc = inst[k + 4]; this.draw(mesh, new Float32Array([c, 0, -s, 0, 0, sc, 0, 0, s, 0, c, 0, inst[k], inst[k + 1], inst[k + 2], 1]), o); } return; }
    const P = this.PI, E = this.env, M = this.PM; gl.useProgram(P.p); if (this.texOn && P._sv !== this._sv) this.setTexUniforms(P, 0);
    if (this._instFrame !== this.frameId) { this._instFrame = this.frameId; // per-frame uniforms
      gl.uniformMatrix4fv(P.u.uVP, false, this.vp); gl.uniform3fv(P.u.uSun, E.sun); gl.uniform3fv(P.u.uSunC, E.sunC); gl.uniform3fv(P.u.uSkyC, E.amb); gl.uniform3fv(P.u.uGndC, E.gnd);
      gl.uniform3fv(P.u.uFogC, E.fogC); gl.uniform2f(P.u.uFog, E.fogN, E.fogF); gl.uniform3fv(P.u.uEye, this.eye); gl.uniform1f(P.u.uTime, this.time); gl.uniform1f(P.u.uWind, E.wind || 0.3);
      gl.uniform1f(P.u.uWet, E.wet || 0); gl.uniform1f(P.u.uFogH, E.fogH == null ? 0 : E.fogH); gl.uniform3fv(P.u.uLP, this.lights); gl.uniform4fv(P.u.uLC, this.lightC);
      gl.uniform4fv(P.u.uTint, ZERO4); gl.uniform1f(P.u.uEmit, 0); gl.uniform1f(P.u.uA, 0); gl.uniform1i(P.u.uLeaf, 3); this.bindModelAtlas(P);
      gl.uniform1i(P.u.uSM, 2); gl.uniformMatrix4fv(P.u.uLVP, false, this.lvp || ID16); gl.uniform1f(P.u.uSMs, this.smSize || 1024); gl.uniform1f(P.u.uSOn, this.shadowOn && this.smTex ? this.shadowOn : 0); }
    gl.uniform1f(P.u.uDetail, o && o.detail || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.b);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.iBuf); gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, count * 5), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(3); gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 20, 16);
    X.vertexAttribDivisorANGLE(3, 1); X.vertexAttribDivisorANGLE(4, 1);
    X.drawArraysInstancedANGLE(gl.TRIANGLES, 0, mesh.n, count);
    X.vertexAttribDivisorANGLE(3, 0); X.vertexAttribDivisorANGLE(4, 0); gl.disableVertexAttribArray(3); gl.disableVertexAttribArray(4);
    this.stats.draws++; this.stats.tris += mesh.n / 3 * count;
    gl.useProgram(M.p);
  }
  drawBlend(mesh, M, o) {
    const gl = this.gl; gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
    this.draw(mesh, M, o); gl.disable(gl.BLEND); gl.depthMask(true);
  }
  drawAdd(mesh, M, o) {
    const gl = this.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    this.draw(mesh, M, o); gl.disable(gl.BLEND); gl.depthMask(true);
  }
  /** directional shadow map around `center`; draw casters with drawShadow() between begin/end */
  beginShadow(center, dir, radius, size, strength) {
    const gl = this.gl;
    if (size !== this.smSize) {
      if (this.smFbo) { gl.deleteTexture(this.smTex); gl.deleteFramebuffer(this.smFbo); gl.deleteRenderbuffer(this.smRb); }
      this.smSize = size; this.smTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.smTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      this.smFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.smFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.smTex, 0);
      this.smRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.smRb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.smRb);
    }
    // texel-snapped orthographic light camera (stable, no shimmering)
    const texel = radius * 2 / size, up = Math.abs(dir[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const view = lookAt([center[0] + dir[0] * 300, center[1] + dir[1] * 300, center[2] + dir[2] * 300], center, up);
    const cx = view[0] * center[0] + view[4] * center[1] + view[8] * center[2] + view[12], cy = view[1] * center[0] + view[5] * center[1] + view[9] * center[2] + view[13];
    const ox = cx - Math.round(cx / texel) * texel, oy = cy - Math.round(cy / texel) * texel;
    const o = new Float32Array(16), n = 1, f = 700; o[0] = 1 / radius; o[5] = 1 / radius; o[10] = -2 / (f - n); o[14] = -(f + n) / (f - n); o[15] = 1; o[12] = -ox / radius; o[13] = -oy / radius;
    this.lvp = mul(o, view); this.shadowOn = strength;
    this.unbindUnits(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.smFbo); gl.viewport(0, 0, size, size); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE);
    const D = this.P.depth; gl.useProgram(D.p); this.bindModelAtlas(D); gl.uniformMatrix4fv(D.u.uLVP, false, this.lvp); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.leafTex || this.dummyTex()); gl.uniform1i(D.u.uLeaf, 3); gl.activeTexture(gl.TEXTURE0); gl.uniform1f(D.u.uTime, this.time); gl.uniform1f(D.u.uWind, this.env ? this.env.wind || 0.3 : 0.3);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
  }
  drawShadow(mesh, M) {
    if (mesh && mesh.multi) { for (const x of mesh.multi) this.drawShadow(x, M); return; }
    if (!mesh || !mesh.n) return; const gl = this.gl, D = this.P.depth;
    gl.uniformMatrix4fv(D.u.uM, false, M); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.b);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    if (mesh.ib) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib); gl.drawElements(gl.TRIANGLES, mesh.ni, gl.UNSIGNED_SHORT, 0); } else gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
    this.stats.draws++;
  }
  endShadow() { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h); }
  noShadow() { this.shadowOn = 0; }
  water(y, ext) {
    if (!this.hTex) return;
    const gl = this.gl, E = this.env, W = this.P.water, I = this.hInfo; gl.useProgram(W.p);
    gl.uniformMatrix4fv(W.u.uVP, false, this.vp); gl.uniform3fv(W.u.uEye, this.eye); gl.uniform1f(W.u.uY, y); gl.uniform1f(W.u.uTime, this.time); gl.uniform1f(W.u.uExt, ext || 1300);
    gl.uniform3fv(W.u.uSun, E.sunDir || E.sun); gl.uniform3fv(W.u.uSunC, E.sunC); gl.uniform3fv(W.u.uSkyC, E.skyTop); gl.uniform3fv(W.u.uHor, E.skyHor); gl.uniform3fv(W.u.uFogC, E.fogC); gl.uniform2f(W.u.uFog, E.fogN, E.fogF);
    gl.uniform1f(W.u.uWaveH, E.waveH == null ? 1 : E.waveH); gl.uniform3fv(W.u.uShal, E.waterShal || [0.16, 0.42, 0.42]); gl.uniform3fv(W.u.uDeep, E.waterDeep || [0.03, 0.11, 0.16]); gl.uniform1f(W.u.uRain, E.rain || 0);
    gl.uniform1f(W.u.uWS, I.worldSize); gl.uniform1f(W.u.uHmin, I.hmin); gl.uniform1f(W.u.uHmax, I.hmax);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.hTex); gl.uniform1i(W.u.uH, 0);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wIdx);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, this.wN, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND); gl.depthMask(true); this.stats.draws++;
    this.useMesh();
  }
  rain(intensity, windV) {
    if (intensity <= 0.01) return;
    const gl = this.gl, R = this.P.rain, E = this.env; gl.useProgram(R.p);
    gl.uniformMatrix4fv(R.u.uVP, false, this.vp); gl.uniform3fv(R.u.uEye, this.eye); gl.uniform1f(R.u.uTime, this.time); gl.uniform1f(R.u.uLen, 0.9);
    gl.uniform3fv(R.u.uWindV, windV || [2, 0, 1]); gl.uniform3fv(R.u.uC, [0.75 * E.amb[0] + 0.25, 0.75 * E.amb[1] + 0.25, 0.75 * E.amb[2] + 0.28]); gl.uniform1f(R.u.uI, intensity);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, Math.floor(this.rN * Math.min(1, intensity) / 2) * 2);
    gl.disable(gl.BLEND); gl.depthMask(true); this.stats.draws++;
    this.useMesh();
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
    gl.useProgram(P.p); gl.uniformMatrix4fv(P.u.uVP, false, this.vp); gl.uniform3fv(P.u.uR, this.camR); gl.uniform3fv(P.u.uU, this.camU); gl.uniform1f(P.u.uSoft, soft); gl.uniform1f(P.u.uTm, this.time);
    gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf); gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, max * 6);
    gl.disable(gl.BLEND); gl.depthMask(true);
    this.useMesh();
    this.stats.draws++;
  }
  /** first-person layer: clear depth, own projection with a tight near plane */
  beginViewModel(fov) {
    const gl = this.gl; gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = perspective(fov, this.w / this.h, 0.01, 20); this.vpVM = mul(proj, this.view);
    this.useMesh(this.vpVM);
  }
  endViewModel() { this.useMesh(); }
  end() {
    const gl = this.gl, E = this.env;
    if (!this.post) return;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    let bloom = 0;
    if (this.q.bloom) {
      const B = this.P.bright; gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1.f); gl.viewport(0, 0, this.b1.W, this.b1.H); gl.useProgram(B.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbo.t); gl.uniform1i(B.u.uT, 0); gl.uniform2f(B.u.uPx, 1.5 / this.w, 1.5 / this.h); this.fs(B);
      const L = this.P.blur; gl.useProgram(L.p); gl.uniform1i(L.u.uT, 0);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b2.f); gl.bindTexture(gl.TEXTURE_2D, this.b1.t); gl.uniform2f(L.u.uD, (1 + i) / this.b1.W, 0); this.fs(L);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.b1.f); gl.bindTexture(gl.TEXTURE_2D, this.b2.t); gl.uniform2f(L.u.uD, 0, (1 + i) / this.b1.H); this.fs(L);
      }
      bloom = E.bloom == null ? 0.9 : E.bloom;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    const C = this.P.comp; gl.useProgram(C.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fbo.t); gl.uniform1i(C.u.uT, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.b1.t); gl.uniform1i(C.u.uB, 1); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(C.u.uFxaa, this.q.fxaa ? 1 : 0); gl.uniform2f(C.u.uPx, 1 / this.w, 1 / this.h);
    gl.uniform1f(C.u.uBloom, bloom); gl.uniform1f(C.u.uVig, E.vig == null ? 0.85 : E.vig); gl.uniform1f(C.u.uSat, E.sat || 1.05); gl.uniform1f(C.u.uCon, E.con || 1.06);
    gl.uniform3fv(C.u.uGrade, E.grade || [1, 1, 1]); gl.uniform3fv(C.u.uLift, E.lift || [0, 0, 0]); gl.uniform1f(C.u.uExp, E.exposure || 1);
    gl.uniform1f(C.u.uFlash, this.fx.flash); gl.uniform3fv(C.u.uFlashC, this.fx.flashC); gl.uniform1f(C.u.uHurt, this.fx.hurt); gl.uniform1f(C.u.uTimeC, (this.time % 10) + 1);
    this.fs(C);
  }
  // a full-screen pass only uses attribute 0; 1 and 2 may still point at a mesh buffer that has since been freed (chunk unload), which makes the driver drop the draw
  fs(P) { const gl = this.gl; gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.bindBuffer(gl.ARRAY_BUFFER, this.fsq); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
}
const ZERO4 = new Float32Array(4), ID16 = (() => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; })();

export function invert(m) {
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
