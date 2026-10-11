import type { Finding, ImageReview, ReviewFrameMetric, SeriesData } from "../types";
import type { EngineHooks } from "./engine";

/**
 * Modalite-bağımsız nicel görüntü incelemesi (TANI/LEZYON DEDEKTÖRÜ DEĞİL).
 * Her karede gerçek piksel verisinden sinyal aralığı ve renkli karelerde RGB dağılımı ölçer.
 * Renkli Doppler pikselleri, US Region Calibration olmadan cm/sn veya akım yönü değildir.
 */
export interface ImageReviewOutput {
  review: ImageReview;
  findings: Finding[];
  notes: string[];
}

const round = (v: number, digits = 1) => Number(v.toFixed(digits));
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

function frameMetrics(series: SeriesData, index: number): ReviewFrameMetric {
  const data = series.slices[index];
  const w = series.width;
  const h = series.height;
  if (!data || data.length !== w * h || w <= 0 || h <= 0) throw new Error(`Kare ${index + 1} piksel boyutu tutarsız; inceleme durduruldu.`);

  let n = 0, sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
  const sampleStep = Math.max(1, Math.ceil(data.length / 24000));
  for (let p = 0; p < data.length; p += sampleStep) {
    const value = data[p];
    if (!Number.isFinite(value)) continue;
    n++; sum += value; sumSq += value * value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const mean = n ? sum / n : 0;
  const std = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;

  const quantiles: number[] = [];
  const quantStep = Math.max(1, Math.ceil(data.length / 2048));
  for (let p = 0; p < data.length; p += quantStep) if (Number.isFinite(data[p])) quantiles.push(data[p]);
  quantiles.sort((a, b) => a - b);
  const contrast = quantiles.length
    ? quantiles[Math.floor((quantiles.length - 1) * 0.98)] - quantiles[Math.floor((quantiles.length - 1) * 0.02)]
    : 0;

  const result: ReviewFrameMetric = {
    sliceIndex: index,
    mean: round(mean),
    std: round(std),
    min: round(n ? min : 0),
    max: round(n ? max : 0),
    contrast: round(Math.max(0, contrast)),
    changeFromPrevious: 0,
  };

  // RGBA bellekte little-endian paketlidir: alt 8 bit kırmızı, sonra yeşil, mavi.
  const rgba = series.rgbaSlices?.[index];
  if (series.isColor && rgba?.length === data.length) {
    let colored = 0, red = 0, blue = 0, total = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const colorStep = Math.max(1, Math.ceil(rgba.length / 45000));
    for (let p = 0; p < rgba.length; p += colorStep) {
      const pixel = rgba[p];
      const r = pixel & 255, g = (pixel >>> 8) & 255, b = (pixel >>> 16) & 255;
      total++;
      // Renk doygunluğu; siyah zemin/gri doku/siyah yazı renkli Doppler olarak sayılmaz.
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (saturation < 55 || Math.max(r, g, b) < 95) continue;
      colored++;
      if (r > b + 35 && r > g + 20) red++;
      if (b > r + 35 && b > g + 20) blue++;
      const x = p % w, y = Math.floor(p / w);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    result.colorCoverage = round(100 * colored / Math.max(total, 1));
    result.redCoverage = round(100 * red / Math.max(total, 1));
    result.blueCoverage = round(100 * blue / Math.max(total, 1));
    if (colored >= 8 && maxX >= minX && maxY >= minY) {
      const pad = 3;
      const x0 = clamp(minX - pad, 0, w - 1), y0 = clamp(minY - pad, 0, h - 1);
      const x1 = clamp(maxX + pad, 0, w - 1), y1 = clamp(maxY + pad, 0, h - 1);
      result.colorBox = { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
    }
  }
  return result;
}

function topUnique(frames: ReviewFrameMetric[], color: boolean): number[] {
  const selected: number[] = [];
  if (color) {
    for (const metric of ["redCoverage", "blueCoverage", "colorCoverage"] as const) {
      const top = [...frames].sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))[0];
      if (top && (top[metric] ?? 0) > 0 && !selected.includes(top.sliceIndex)) selected.push(top.sliceIndex);
    }
  }
  if (!selected.length) {
    const order = [...frames].sort((a, b) => b.changeFromPrevious - a.changeFromPrevious || b.contrast - a.contrast);
    selected.push(...order.slice(0, Math.min(3, frames.length)).map((m) => m.sliceIndex));
  }
  return selected.sort((a, b) => a - b);
}

function observation(series: SeriesData, frame: ReviewFrameMetric, color: boolean, index: number): Finding {
  const frameName = ["US", "XA", "RF", "XC", "IVUS", "OCT"].includes(series.modality.toUpperCase()) ? "Kare" : "Kesit";
  const colorText = `Renkli alan %${frame.colorCoverage ?? 0}; kırmızı ağırlıklı pikseller %${frame.redCoverage ?? 0}, mavi ağırlıklı pikseller %${frame.blueCoverage ?? 0}.`;
  const detail = color
    ? `${frameName} ${frame.sliceIndex + 1}: ${colorText} Bu yalnızca RGB görüntüdeki renk dağılımıdır; DICOM bölge kalibrasyonu olmadan akış hızı, yönü veya hastalık yorumu yapılamaz.`
    : `${frameName} ${frame.sliceIndex + 1}: ortalama ${frame.mean}, standart sapma ${frame.std}, %2–%98 sinyal aralığı ${frame.contrast}; önceki kareye göre nicel değişim %${frame.changeFromPrevious}. Bunlar lezyon, normal bulgu veya klinik tanı değildir.`;
  return {
    id: `review-${index + 1}`,
    sliceIndex: frame.sliceIndex,
    sliceStart: frame.sliceIndex,
    sliceEnd: frame.sliceIndex,
    keySliceNumber: frame.sliceIndex + 1,
    sliceRangeStr: `${frameName} ${frame.sliceIndex + 1}`,
    anatomicalLocation: color ? "RGB renkli piksel alanı (görsel ölçüm)" : "Tüm görüntü (istatistiksel ölçüm)",
    densityOrSignal: color ? colorText : `Ortalama ${frame.mean} · SS ${frame.std} · aralık ${frame.contrast}`,
    sizeMmStr: color && frame.colorBox ? "Görsel alan (mm/sn değil)" : `${series.width}×${series.height} piksel`,
    bbox: color ? frame.colorBox ?? null : null,
    label: color ? "Renkli piksel dağılımı — inceleme noktası" : "Sinyal dağılımı — inceleme noktası",
    detail,
    category: "Görüntü ölçümü",
    severity: "normal",
    confidence: 0,
    confidenceKind: "none",
    source: "image-review",
  };
}

export async function runImageReview(
  series: SeriesData,
  hooks: EngineHooks
): Promise<ImageReviewOutput | null> {
  if (series.specialType && series.specialType !== "image") throw new Error("Belge/EKG nesnesinde görüntü pikselleri yok; kare incelemesi uygulanamaz.");
  if (series.slices.length === 0) throw new Error("Seride incelenebilir görüntü/kare yok.");

  const frames: ReviewFrameMetric[] = [];
  const color = !!series.isColor && !!series.rgbaSlices?.length;
  for (let i = 0; i < series.slices.length; i++) {
    if (hooks.aborted()) return null;
    const metric = frameMetrics(series, i);
    const prev = frames[i - 1];
    if (prev) {
      const grayDelta = 100 * (Math.abs(metric.mean - prev.mean) + Math.abs(metric.std - prev.std)) /
        Math.max(metric.contrast, prev.contrast, 1);
      const colorDelta = color
        ? Math.abs((metric.redCoverage ?? 0) - (prev.redCoverage ?? 0)) +
          Math.abs((metric.blueCoverage ?? 0) - (prev.blueCoverage ?? 0))
        : 0;
      metric.changeFromPrevious = round(clamp(grayDelta + colorDelta, 0, 100));
    }
    frames.push(metric);
    await hooks.onSlice(i, series.slices.length);
  }
  if (hooks.aborted()) return null;

  const notes = [
    `Gerçek ${frames.length} görüntü/kare piksel olarak incelendi. Bu özellik otomatik hastalık tanısı veya acil klinik triyaj yapmaz.`,
    color
      ? "Renkli Doppler yüzdeleri yalnızca ekrandaki kırmızı/mavi RGB piksel oranıdır: kan hızı, akış yönü, perfüzyon, stenoz veya aciliyet ölçümü DEĞİLDİR. Fiziksel değer için DICOM US Region Calibration ve klinik model gerekir."
      : "MR/grafi/diğer modalitelerde sinyal ve kontrast değerleri, farklı cihaz/sekanslar arasında doğrudan hastalık karşılaştırması olarak kullanılamaz.",
  ];
  const keyFrames = topUnique(frames, color);
  return {
    review: { modality: series.modality, frameCount: frames.length, mode: color ? "color" : "grayscale", frames, keyFrames, notes },
    findings: keyFrames.map((key, i) => observation(series, frames[key], color, i)),
    notes,
  };
}
