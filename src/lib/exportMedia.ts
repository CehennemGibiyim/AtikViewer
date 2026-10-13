import { zipSync } from "fflate";
import type { SeriesData } from "./types";

export interface RenderOpts { wl: number; ww: number; invert: boolean; maxSide: number }

/** Bir kesiti pencere/seviye ile tuvale çizer (en uzun kenar ≤ maxSide). */
export function renderSliceCanvas(s: SeriesData, slice: number, o: RenderOpts): HTMLCanvasElement {
  const W = s.width, H = s.height;
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  const ctx = src.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const u32 = new Uint32Array(img.data.buffer);
  const idx = Math.min(slice, s.slices.length - 1);
  if (s.isColor && s.rgbaSlices?.[idx]) u32.set(s.rgbaSlices[idx]);
  else {
    const sl = s.slices[idx];
    const lo = o.wl - o.ww / 2, k = 255 / Math.max(1, o.ww);
    for (let i = 0; i < sl.length; i++) {
      let g = (sl[i] - lo) * k; g = g < 0 ? 0 : g > 255 ? 255 : g; if (o.invert) g = 255 - g;
      const gi = g | 0; u32[i] = 0xff000000 | (gi << 16) | (gi << 8) | gi;
    }
  }
  ctx.putImageData(img, 0, 0);
  const sc = Math.min(2, o.maxSide / Math.max(W, H));
  // video kodlayıcıları çift boyut ister
  const w = Math.max(2, Math.round((W * sc) / 2) * 2), h = Math.max(2, Math.round((H * sc) / 2) * 2);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = sc < 3;
  octx.fillStyle = "#000"; octx.fillRect(0, 0, w, h);
  octx.drawImage(src, 0, 0, w, h);
  return out;
}

export interface MediaOpts extends RenderOpts { from: number; to: number; fps: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kesit aralığını WebM videoya kaydeder (MediaRecorder). Anonimleştirme yapmaz: hasta bilgisi görüntüye gömülmez, yalnızca piksel verisi. */
export async function exportVideoWebm(s: SeriesData, o: MediaOpts): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("Bu tarayıcı video kaydını (MediaRecorder) desteklemiyor.");
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("WebM kodlayıcı bulunamadı.");
  const first = renderSliceCanvas(s, o.from, o);
  const cv = document.createElement("canvas");
  cv.width = first.width; cv.height = first.height;
  const ctx = cv.getContext("2d")!;
  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });
  rec.start(250);
  const total = o.to - o.from + 1;
  const frameMs = 1000 / o.fps;
  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) { rec.stop(); throw new Error("İptal edildi"); }
    ctx.drawImage(renderSliceCanvas(s, o.from + i, o), 0, 0);
    track.requestFrame?.();
    o.onProgress?.(i + 1, total);
    await sleep(frameMs);
  }
  await sleep(frameMs);
  rec.stop();
  await done;
  return new Blob(chunks, { type: "video/webm" });
}

/** Kesit aralığını PNG dosyaları olarak ZIP'ler. */
export async function exportPngZip(s: SeriesData, o: MediaOpts): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  const total = o.to - o.from + 1;
  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) throw new Error("İptal edildi");
    const cv = renderSliceCanvas(s, o.from + i, o);
    const blob: Blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("PNG üretilemedi"))), "image/png"));
    entries[`kesit-${String(o.from + i + 1).padStart(4, "0")}.png`] = new Uint8Array(await blob.arrayBuffer());
    o.onProgress?.(i + 1, total);
    if (i % 8 === 0) await sleep(0);
  }
  return zipSync(entries, { level: 0 });
}
