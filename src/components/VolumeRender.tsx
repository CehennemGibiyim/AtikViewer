"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SeriesData } from "@/lib/types";
import { isoSurface, toBinaryStl, volGeo } from "@/lib/volume";

/**
 * 3B hacim görüntüleme (WebGL2 ışın izleme): VR (opaklık/renk aktarım işlevi, isteğe bağlı gölgelendirme) ve MIP.
 * Hacim ≤ 192×192×256 kuyruğa küçültülüp 8 bit 3B doku olarak GPU'ya yüklenir. Yalnızca görselleştirmedir; ölçüm için değildir.
 */
const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const FRAG = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler3D uVol; uniform vec3 uHalf; uniform mat3 uRot; uniform vec2 uRes; uniform float uZoom;
uniform float uThr, uOpac, uShade; uniform int uMode, uPreset; uniform vec3 uTexel;
vec3 ramp(float d){
  if(uPreset==0) return mix(vec3(.55,.5,.42), vec3(1.,.97,.9), d);          // kemik
  if(uPreset==1) return mix(vec3(.55,.2,.18), vec3(1.,.8,.7), d);           // yumuşak doku
  if(uPreset==2) return mix(vec3(.1,.0,.0), mix(vec3(1.,.2,0.), vec3(1.,1.,.7), d), clamp(d*1.6,0.,1.)); // sıcak
  return vec3(d);                                                           // gri
}
bool box(vec3 ro, vec3 rd, out float t0, out float t1){
  vec3 inv = 1./rd; vec3 a = (-uHalf-ro)*inv, b = (uHalf-ro)*inv;
  vec3 mn = min(a,b), mx = max(a,b);
  t0 = max(max(mn.x,mn.y),max(mn.z,0.)); t1 = min(min(mx.x,mx.y),mx.z);
  return t1>t0;
}
vec3 tc(vec3 q){ // nesne uzayı (X sağ, Y yukarı=kesit, Z izleyiciye=ön) → doku koordinatı
  return vec3(q.x/(2.*uHalf.x)+.5, .5 - q.z/(2.*uHalf.z), q.y/(2.*uHalf.y)+.5);
}
void main(){
  vec2 p = (gl_FragCoord.xy - .5*uRes) / (.5*min(uRes.x,uRes.y)) / uZoom;
  vec3 ro = uRot*vec3(0.,0.,3.), rd = normalize(uRot*vec3(p,-2.2));
  float t0,t1; if(!box(ro,rd,t0,t1)){ o = vec4(.02,.03,.05,1.); return; }
  const int N = 220; float dt = (t1-t0)/float(N);
  vec4 acc = vec4(0.); float mxv = 0.;
  for(int i=0;i<N;i++){
    vec3 q = ro + rd*(t0 + (float(i)+.5)*dt);
    float d = texture(uVol, tc(q)).r;
    if(uMode==1){ mxv = max(mxv,d); continue; }
    float a = smoothstep(uThr, uThr+.22, d) * uOpac * dt * 45.;
    if(a<=0.003) continue;
    vec3 c = ramp(d);
    if(uShade>.5){
      vec3 g = vec3(texture(uVol,tc(q)+vec3(uTexel.x,0,0)).r - texture(uVol,tc(q)-vec3(uTexel.x,0,0)).r,
                    texture(uVol,tc(q)+vec3(0,uTexel.y,0)).r - texture(uVol,tc(q)-vec3(0,uTexel.y,0)).r,
                    texture(uVol,tc(q)+vec3(0,0,uTexel.z)).r - texture(uVol,tc(q)-vec3(0,0,uTexel.z)).r);
      float gl = length(g);
      if(gl>1e-4){ vec3 n = -normalize(vec3(g.x, g.z, -g.y)); c *= .35 + .75*max(0., dot(n, -rd)); }
    }
    a = min(a,1.); acc.rgb += (1.-acc.a)*a*c; acc.a += (1.-acc.a)*a;
    if(acc.a>.97) break;
  }
  if(uMode==1){ o = vec4(ramp(mxv)*smoothstep(uThr*.5,uThr*.5+.1,mxv),1.); return; }
  o = vec4(acc.rgb + (1.-acc.a)*vec3(.02,.03,.05), 1.);
}`;

interface Props { series: SeriesData }
type Preset = { name: string; lo: number; hi: number; thr: number; look: number };

const MAXD = 192;

function buildGrid(s: SeriesData) {
  const g = volGeo(s);
  const fx = Math.max(1, Math.ceil(Math.max(g.w, g.h) / MAXD));
  const gx = Math.ceil(g.w / fx), gy = Math.ceil(g.h / fx);
  const fz = Math.max(1, Math.ceil(g.n / 256));
  const gz = Math.ceil(g.n / fz);
  const grid = new Float32Array(gx * gy * gz);
  for (let z = 0; z < gz; z++) {
    const sl = s.slices[Math.min(g.n - 1, z * fz)];
    for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) grid[(z * gy + y) * gx + x] = sl[Math.min(g.h - 1, y * fx) * g.w + Math.min(g.w - 1, x * fx)];
  }
  const sorted = Float32Array.from(grid.length > 400000 ? grid.filter((_, i) => i % Math.ceil(grid.length / 400000) === 0) : grid).sort();
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { grid, gx, gy, gz, geo: g, p2: pct(0.02), p50: pct(0.5), p995: pct(0.995), pMax: sorted[sorted.length - 1] };
}

export default function VolumeRender({ series }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const gl = useRef<{ gl: WebGL2RenderingContext; prog: WebGLProgram; tex: WebGLTexture; u: Record<string, WebGLUniformLocation | null> } | null>(null);
  const [err, setErr] = useState("");
  const [size, setSize] = useState({ w: 400, h: 400 });
  const [cam, setCam] = useState({ yaw: 25, pitch: -15, zoom: 2.1 });
  const vol = useMemo(() => buildGrid(series), [series]);
  const isCT = series.modality === "CT";
  const presets: Preset[] = useMemo(() => isCT
    ? [{ name: "Kemik", lo: 200, hi: 1400, thr: 0.12, look: 0 }, { name: "Yumuşak doku", lo: -100, hi: 300, thr: 0.3, look: 1 }, { name: "Gri", lo: -200, hi: 600, thr: 0.25, look: 3 }]
    : [{ name: "Otomatik", lo: vol.p2, hi: vol.p995, thr: 0.25, look: 3 }, { name: "Sıcak", lo: vol.p50, hi: vol.p995, thr: 0.2, look: 2 }],
  [isCT, vol]);
  const [pi, setPi] = useState(0);
  const base = presets[Math.min(pi, presets.length - 1)];
  const [lo, setLo] = useState(base.lo);
  const [hi, setHi] = useState(base.hi);
  const [thr, setThr] = useState(base.thr);
  const [opac, setOpac] = useState(0.9);
  const [mode, setMode] = useState<0 | 1>(0);
  const [shade, setShade] = useState(true);
  const [stlBusy, setStlBusy] = useState("");
  const [stlThr, setStlThr] = useState(isCT ? 250 : Math.round(vol.p50 + (vol.p995 - vol.p50) * 0.4));
  const [stlQ, setStlQ] = useState(128);

  const applyPreset = (i: number) => { const p = presets[i]; setPi(i); setLo(p.lo); setHi(p.hi); setThr(p.thr); };

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(80, el.clientWidth), h: Math.max(80, el.clientHeight) }));
    ro.observe(el); setSize({ w: Math.max(80, el.clientWidth), h: Math.max(80, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  // GL kurulumu + doku
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!ctx) { setErr("Bu tarayıcı/cihaz WebGL2 desteklemiyor; 3B hacim görüntüleme kullanılamaz."); return; }
    const sh = (type: number, src: string) => { const s = ctx.createShader(type)!; ctx.shaderSource(s, src); ctx.compileShader(s); if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) throw new Error(ctx.getShaderInfoLog(s) ?? "shader"); return s; };
    try {
      const prog = ctx.createProgram()!;
      ctx.attachShader(prog, sh(ctx.VERTEX_SHADER, VERT)); ctx.attachShader(prog, sh(ctx.FRAGMENT_SHADER, FRAG)); ctx.linkProgram(prog);
      if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) throw new Error(ctx.getProgramInfoLog(prog) ?? "link");
      ctx.useProgram(prog);
      const buf = ctx.createBuffer(); ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
      ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
      const loc = ctx.getAttribLocation(prog, "p"); ctx.enableVertexAttribArray(loc); ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
      const tex = ctx.createTexture()!;
      ctx.bindTexture(ctx.TEXTURE_3D, tex);
      ctx.texParameteri(ctx.TEXTURE_3D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR); ctx.texParameteri(ctx.TEXTURE_3D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
      for (const w of [ctx.TEXTURE_WRAP_S, ctx.TEXTURE_WRAP_T, ctx.TEXTURE_WRAP_R]) ctx.texParameteri(ctx.TEXTURE_3D, w, ctx.CLAMP_TO_EDGE);
      ctx.pixelStorei(ctx.UNPACK_ALIGNMENT, 1);
      const names = ["uVol", "uHalf", "uRot", "uRes", "uZoom", "uThr", "uOpac", "uShade", "uMode", "uPreset", "uTexel"];
      const u: Record<string, WebGLUniformLocation | null> = {}; for (const n of names) u[n] = ctx.getUniformLocation(prog, n);
      gl.current = { gl: ctx, prog, tex, u };
      setErr("");
    } catch (e) { setErr(`WebGL başlatılamadı: ${e instanceof Error ? e.message.slice(0, 120) : "bilinmeyen hata"}`); }
    return () => { gl.current = null; ctx.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, []);

  // doku (pencereye göre 8 bit normalizasyon)
  const [texTick, setTexTick] = useState(0);
  useEffect(() => {
    const G = gl.current; if (!G) return;
    const { gl: ctx, tex } = G;
    const u8 = new Uint8Array(vol.grid.length);
    const k = 255 / Math.max(1e-6, hi - lo);
    for (let i = 0; i < u8.length; i++) { const v = (vol.grid[i] - lo) * k; u8[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    ctx.bindTexture(ctx.TEXTURE_3D, tex);
    ctx.texImage3D(ctx.TEXTURE_3D, 0, ctx.R8, vol.gx, vol.gy, vol.gz, 0, ctx.RED, ctx.UNSIGNED_BYTE, u8);
    setTexTick((t) => t + 1);
  }, [vol, lo, hi, err]);

  const draw = useCallback(() => {
    const G = gl.current, c = cv.current; if (!G || !c) return;
    const { gl: ctx, u } = G;
    const sc = Math.min(1, 640 / Math.max(size.w, size.h));
    const w = Math.round(size.w * sc), h = Math.round(size.h * sc);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.viewport(0, 0, w, h);
    const g = vol.geo, ext = Math.max(g.w * g.sx, g.h * g.sy, g.n * g.sz);
    ctx.uniform3f(u.uHalf, (g.w * g.sx) / ext / 2, (g.n * g.sz) / ext / 2, (g.h * g.sy) / ext / 2);
    const yw = (cam.yaw * Math.PI) / 180, pt = (cam.pitch * Math.PI) / 180;
    const cy = Math.cos(yw), sy = Math.sin(yw), cx = Math.cos(pt), sx = Math.sin(pt);
    // R = Ry(yaw) · Rx(pitch)  (sütun-öncelikli)
    const R = [cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx];
    ctx.uniformMatrix3fv(u.uRot, false, new Float32Array(R));
    ctx.uniform2f(u.uRes, w, h); ctx.uniform1f(u.uZoom, cam.zoom);
    ctx.uniform1f(u.uThr, thr); ctx.uniform1f(u.uOpac, opac); ctx.uniform1f(u.uShade, shade ? 1 : 0);
    ctx.uniform1i(u.uMode, mode); ctx.uniform1i(u.uPreset, base.look);
    ctx.uniform3f(u.uTexel, 1 / vol.gx, 1 / vol.gy, 1 / vol.gz);
    ctx.activeTexture(ctx.TEXTURE0); ctx.bindTexture(ctx.TEXTURE_3D, G.tex); ctx.uniform1i(u.uVol, 0);
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
  }, [size, cam, thr, opac, shade, mode, base.look, vol]);
  useEffect(() => { draw(); }, [draw, texTick, err]);

  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const exportStl = async () => {
    setStlBusy("Yüzey hesaplanıyor…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const t0 = performance.now();
      const mesh = isoSurface(series, stlThr, stlQ);
      if (mesh.count === 0) { setStlBusy("Bu eşikte yüzey yok; eşiği değiştirin."); return; }
      const bytes = toBinaryStl(mesh, `${series.modality}-${series.description}`.slice(0, 60));
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "model/stl" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzey-${series.modality}-${stlThr}.stl`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      setStlBusy(`STL hazır: ${mesh.count.toLocaleString("tr-TR")} üçgen · ${(bytes.length / 1e6).toFixed(1)} MB · ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { setStlBusy(`STL oluşturulamadı: ${e instanceof Error ? e.message : "hata"}`); }
  };

  const btn = (on: boolean) => `cursor-pointer rounded px-2 py-0.5 font-bold ${on ? "bg-cyan-400/20 text-cyan-200 ring-1 ring-cyan-400/50" : "bg-[#141b24] text-slate-300 hover:bg-[#1f2937]"}`;
  return (
    <div className="flex h-full min-h-0 flex-col text-[11px] text-slate-300">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[#1a2230] bg-[#0b0f16] px-2 py-1">
        <button className={btn(mode === 0)} onClick={() => setMode(0)}>VR</button>
        <button className={btn(mode === 1)} onClick={() => setMode(1)}>MIP</button>
        <span className="mx-1 text-slate-600">|</span>
        {presets.map((p, i) => <button key={p.name} className={btn(pi === i)} onClick={() => applyPreset(i)}>{p.name}</button>)}
        <label className="ml-1 flex items-center gap-1"><input type="checkbox" checked={shade} onChange={(e) => setShade(e.target.checked)} />Gölge</label>
        <label className="flex items-center gap-1">Eşik<input aria-label="Eşik" type="range" min={0} max={90} value={Math.round(thr * 100)} onChange={(e) => setThr(Number(e.target.value) / 100)} className="w-16" /></label>
        <label className="flex items-center gap-1">Opaklık<input aria-label="Opaklık" type="range" min={5} max={100} value={Math.round(opac * 100)} onChange={(e) => setOpac(Number(e.target.value) / 100)} className="w-16" /></label>
        <label className="flex items-center gap-1">Alt<input aria-label="Alt değer" type="number" value={Math.round(lo)} onChange={(e) => setLo(Number(e.target.value))} className="w-14 rounded border border-[#1e2735] bg-[#0e141d] px-1" /></label>
        <label className="flex items-center gap-1">Üst<input aria-label="Üst değer" type="number" value={Math.round(hi)} onChange={(e) => setHi(Math.max(lo + 1, Number(e.target.value)))} className="w-14 rounded border border-[#1e2735] bg-[#0e141d] px-1" /></label>
        <button className={btn(false)} onClick={() => setCam({ yaw: 25, pitch: -15, zoom: 2.1 })}>Sıfırla</button>
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1 bg-[#05070a]">
        <canvas
          ref={cv} data-testid="vr-canvas" style={{ width: "100%", height: "100%", cursor: "grab", touchAction: "none" }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; setCam((c) => ({ ...c, yaw: d.yaw - (e.clientX - d.x) * 0.5, pitch: Math.max(-89, Math.min(89, d.pitch - (e.clientY - d.y) * 0.5)) })); }}
          onPointerUp={() => { drag.current = null; }}
          onWheel={(e) => setCam((c) => ({ ...c, zoom: Math.max(0.4, Math.min(5, c.zoom * (e.deltaY > 0 ? 0.9 : 1.1))) }))}
        />
        {err && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-amber-300">{err}</div>}
        <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-slate-500">Sürükle: döndür · Tekerlek: yakınlaştır · {vol.gx}×{vol.gy}×{vol.gz} doku</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#1a2230] bg-[#0b0f16] px-2 py-1">
        <span className="font-bold text-cyan-300">STL</span>
        <label className="flex items-center gap-1">Eşik<input aria-label="STL eşiği" type="number" value={stlThr} onChange={(e) => setStlThr(Number(e.target.value))} className="w-16 rounded border border-[#1e2735] bg-[#0e141d] px-1" />{series.unit}</label>
        <label className="flex items-center gap-1">Kalite
          <select aria-label="STL kalitesi" value={stlQ} onChange={(e) => setStlQ(Number(e.target.value))} className="rounded border border-[#1e2735] bg-[#0e141d] px-1">
            <option value={96}>Hızlı</option><option value={128}>Orta</option><option value={192}>İnce (yavaş)</option>
          </select>
        </label>
        <button data-testid="stl-btn" className={btn(false)} onClick={() => void exportStl()}>⬇ STL indir</button>
        <span className="text-slate-400">{stlBusy}</span>
      </div>
    </div>
  );
}
