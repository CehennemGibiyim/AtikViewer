import type { DicomDataSet } from "dicom-parser";
import type { SuvInfo } from "./types";

/** DICOM TM ("HHMMSS.frac") → gün içi saniye. */
export function parseTm(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{2})(\d{2})?(\d{2})?(\.\d+)?/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0);
}

/** DICOM DA ("YYYYMMDD") → epoch saniye (gün başlangıcı); geçersizse 0. Yalnızca farklar kullanılır. */
function dayEpoch(date: string | undefined): number {
  const d = (date ?? "").trim();
  if (!/^\d{8}$/.test(d)) return 0;
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) / 1000;
}

export interface SuvInputs {
  weightKg: number;
  doseBq: number;
  halfLifeS: number;
  /** Enjeksiyondan ölçüm referans zamanına kadar geçen süre (s). */
  deltaS: number;
}

/** SUVbw çarpanı: SUV = piksel(Bq/mL) × çarpan. Kaynak: QIBA/DICOM PS3.3 C.8.9.1. */
export function suvFactor(i: SuvInputs): number {
  const decayed = i.doseBq * Math.pow(2, -i.deltaS / i.halfLifeS);
  return (i.weightKg * 1000) / decayed;
}

/**
 * PET (PT) veri kümesinden SUVbw çarpanını çıkarır. Eksik/uyumsuz etiket varsa
 * `factor` null olur ve `note` nedenini söyler; tahmin yürütülmez.
 */
export function suvFromDataset(ds: DicomDataSet, seriesTimes: (number | null)[] = []): SuvInfo {
  const units = (ds.string("x00541001") || "").trim().toUpperCase();
  const base: SuvInfo = { factor: null, units, note: "", kind: "SUVbw" };
  if (units === "GML") return { ...base, factor: 1, note: "Birim zaten g/mL (SUV): çarpan 1." };
  if (units && units !== "BQML") return { ...base, note: `Birim ${units}: SUV yalnızca BQML için hesaplanır.` };

  const weightKg = ds.floatString("x00101030");
  if (!weightKg || weightKg <= 0) return { ...base, note: "Hasta ağırlığı (0010,1030) yok." };
  const item = ds.elements.x00540016?.items?.[0]?.dataSet;
  if (!item) return { ...base, note: "Radyofarmasötik bilgisi (0054,0016) yok." };
  const doseBq = item.floatString("x00181074");
  const halfLifeS = item.floatString("x00181075");
  if (!doseBq || !halfLifeS) return { ...base, note: "Toplam doz (0018,1074) veya yarı ömür (0018,1075) yok." };

  const seriesDate = (ds.string("x00080021") || ds.string("x00080020") || "").trim();
  const startDT = (item.string("x00181078") || "").trim();
  const startTod = startDT.length >= 14 ? parseTm(startDT.slice(8)) : parseTm(item.string("x00181072"));
  const startS = startTod === null ? null : (startDT.length >= 8 ? dayEpoch(startDT.slice(0, 8)) : dayEpoch(seriesDate)) + startTod;
  const decayCorr = (ds.string("x00541102") || "").trim().toUpperCase();
  const refTod = seriesTimes.find((t) => t !== null) ?? parseTm(ds.string("x00080031") || ds.string("x00080032"));
  const refS = refTod === null || refTod === undefined ? null : dayEpoch(seriesDate) + refTod;
  if (startS === null || refS === null) return { ...base, note: "Enjeksiyon/seri zamanı okunamadı." };
  let deltaS = refS - startS;
  if (deltaS < 0 && deltaS > -86400) deltaS += 86400; // gece yarısı geçişi (tarih yoksa)
  if (deltaS < 0 || deltaS > 12 * 3600) return { ...base, note: `Enjeksiyon–görüntüleme süresi (${Math.round(deltaS / 60)} dk) beklenmedik; SUV hesaplanmadı.` };
  if (decayCorr && decayCorr !== "START" && decayCorr !== "ADMIN") return { ...base, note: `Bozunma düzeltmesi "${decayCorr}": SUV hesaplanmadı.` };
  return {
    ...base,
    factor: suvFactor({ weightKg, doseBq, halfLifeS, deltaS }),
    weightKg, doseBq, halfLifeS, deltaS,
    note: `SUVbw · ${weightKg.toFixed(0)} kg · ${(doseBq / 1e6).toFixed(0)} MBq · ${Math.round(deltaS / 60)} dk · bozunma düzeltmeli`,
  };
}
