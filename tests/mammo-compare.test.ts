import assert from "node:assert/strict";
import type { Pixels, SeriesData } from "../src/lib/types";
import {
  BLINK_DEFAULT_HZ,
  BLINK_MAX_HZ,
  BLINK_MIN_HZ,
  blinkIntervalMs,
  blinkSideAt,
  clampBlinkHz,
  counterpartOf,
  diffGray,
  diffRgba,
  frameIndexFor,
  isMammoSeries,
  normalizeView,
  pairLabel,
  pairMammoSeries,
  resample,
  toFloat,
  toGray,
} from "../src/lib/mammoCompare";

function mg(opts: {
  laterality: "R" | "L";
  view: string;
  dbt?: boolean;
  w?: number;
  h?: number;
  slices?: Pixels[];
}): SeriesData {
  const w = opts.w ?? 4;
  const h = opts.h ?? 4;
  const id = `${opts.laterality}-${opts.view}${opts.dbt ? "-dbt" : ""}`;
  return {
    id,
    modality: "MG",
    description: `${opts.laterality} ${opts.view}`,
    bodyPart: "BREAST",
    patientName: "TEST",
    patientId: "1",
    patientAge: "50Y",
    patientSex: "F",
    studyDate: "2026-01-01",
    institution: "TEST",
    studyUid: "1.2.3",
    width: w,
    height: h,
    pixelSpacing: 0.1,
    sliceThickness: 0,
    defaultWL: 128,
    defaultWW: 256,
    unit: "US",
    mammo: {
      laterality: opts.laterality,
      viewPosition: opts.view,
      implant: false,
      tomosynthesis: Boolean(opts.dbt),
    },
    slices: opts.slices ?? [new Float32Array(w * h)],
    lesions: [],
    tags: [],
    isSample: false,
  };
}

function main() {
  // 1) Poz normalizasyonu (üretici yazımları)
  assert.equal(normalizeView("CC"), "CC");
  assert.equal(normalizeView("xcc l"), "CC");
  assert.equal(normalizeView("MLO"), "MLO");
  assert.equal(normalizeView("QMLO"), "MLO");
  assert.equal(normalizeView("ML"), "ML");
  assert.equal(normalizeView(""), "");
  console.log("PASS Poz normalizasyonu: XCCL/QMLO gibi üretici yazımları CC/MLO'ya indi.");

  assert.equal(isMammoSeries(mg({ laterality: "R", view: "CC" })), true);
  console.log("PASS Mamografi serisi tanıma: MG modalitesi/etiketleri doğru algılanıyor.");

  // 2) Çift eşleştirme: aynı poz + zıt taraf; DBT ile 2D karışmaz
  const series = [
    mg({ laterality: "R", view: "CC" }),
    mg({ laterality: "L", view: "cc" }),
    mg({ laterality: "R", view: "MLO" }),
    mg({ laterality: "L", view: "MLO", dbt: true }),
    mg({ laterality: "R", view: "MLO", dbt: true }),
  ];
  const { pairs, unpaired } = pairMammoSeries(series);
  assert.equal(pairs.length, 2, "CC ve MLO için iki çift beklenir");
  const byView = new Map(pairs.map((p) => [`${p.view}-${p.tomosynthesis}`, p]));
  assert(byView.has("CC-false"), "2D CC çifti yok");
  assert(byView.has("MLO-true"), "DBT MLO çifti yok");
  assert.equal(unpaired.length, 0, `eşleşmeyen seri kalmamalı: ${unpaired.map((s) => s.id).join(",")}`);
  assert.equal(byView.get("CC-false")!.right.mammo?.laterality, "R");
  assert.equal(byView.get("CC-false")!.left.mammo?.laterality, "L");
  console.log(`PASS Çift eşleştirme: ${pairs.map(pairLabel).join(" | ")}`);

  // 3) Tek taraflı seri eşleşme üretmez, eşleşmeyenlere düşer
  const single = pairMammoSeries([mg({ laterality: "R", view: "CC" })]);
  assert.equal(single.pairs.length, 0);
  assert.equal(single.unpaired.length, 1);
  const noLat = mg({ laterality: "R", view: "CC" });
  noLat.mammo = { laterality: "", viewPosition: "CC", implant: false, tomosynthesis: false };
  assert.equal(pairMammoSeries([noLat]).pairs.length, 0, "laterality yoksa çift kurulmamalı");
  console.log("PASS Tek taraflı/etiketsiz seri: çift kurulmuyor, sessizce boş panel açılmıyor.");

  // 4) Karşıt taraf bulma
  const rcc = series[0];
  assert.equal(counterpartOf(rcc, series)?.id, "L-cc");
  assert.equal(counterpartOf(series[3], series)?.id, "R-MLO-dbt");
  console.log("PASS Karşıt taraf: doğru seri eşleşiyor (CC↔CC, DBT MLO↔DBT MLO).");

  // 5) DBT kare indeksi eşleme (farklı kare sayıları)
  assert.equal(frameIndexFor(60, 60, 17), 17);
  assert.equal(frameIndexFor(60, 1, 0), 0);
  assert.equal(frameIndexFor(1, 60, 59), 0);
  assert.equal(frameIndexFor(60, 30, 0), 0);
  assert.equal(frameIndexFor(60, 30, 29), 59);
  assert.equal(frameIndexFor(60, 30, 14), 29);
  assert.equal(frameIndexFor(0, 5, 3), 0);
  console.log("PASS DBT kare eşleme: uçlar tam oturuyor, 60→30 karede indeksler doğru ölçekleniyor.");

  // 6) Yeniden örnekleme ve gri ton
  const src = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const up = resample(src, 3, 3, 6, 6);
  assert.equal(up.length, 36);
  assert.equal(up[0], 1);
  assert.equal(up[35], 9);
  assert.deepEqual([...resample(src, 3, 3, 3, 3)], [...src]);

  const pixels = toFloat(new Int16Array([0, 100, 200, 1000]));
  const gray = toGray(pixels, 100, 200);
  assert.equal(gray[0], 0);
  assert.equal(gray[1], 64);
  assert.equal(gray[3], 255);
  assert.equal(toGray(pixels, 100, 200, true)[0], 255);
  console.log("PASS Görüntü hazırlığı: yeniden örnekleme boyutu koruyor, pencere 8-bit'e doğru oturuyor.");

  // 7) Fark modu
  const flat = new Uint8Array([10, 20, 30, 40]);
  assert.deepEqual([...diffGray(flat, flat)], [0, 0, 0, 0], "aynı görüntüde fark sıfır olmalı");
  const brighter = new Uint8Array([12, 20, 70, 40]);
  assert.deepEqual([...diffGray(flat, brighter, 1)], [2, 0, 40, 0]);
  assert.equal(diffGray(flat, flat, 1)[2], 0);
  assert.equal(diffGray(new Uint8Array([0]), new Uint8Array([255]), 8)[0], 255, "fark 255'te doyar");

  const rgba = diffRgba(flat, brighter, 1);
  assert.equal(rgba[0 * 4], 0, "sol daha koyuysa kırmızı kanalı boş");
  assert.equal(rgba[2 * 4], 0, "sol daha parlak bölgede kırmızı");
  assert.equal(rgba[2 * 4 + 2], 0);
  const rgba2 = diffRgba(brighter, flat, 1);
  assert.equal(rgba2[2 * 4], 0);
  assert.equal(rgba2[2 * 4 + 2], 40, "sağ daha parlak bölgede mavi");
  console.log("PASS Fark modu: aynı görüntüde sıfır, yönlü renkte kırmızı/mavi ayrımı doğru.");

  // 8) Blink zamanlaması
  assert.equal(clampBlinkHz(0.1), BLINK_MIN_HZ);
  assert.equal(clampBlinkHz(99), BLINK_MAX_HZ);
  assert.equal(clampBlinkHz(Number.NaN), BLINK_DEFAULT_HZ);
  assert.equal(blinkIntervalMs(2), 500);
  assert.equal(blinkSideAt(0, 2), "right");
  assert.equal(blinkSideAt(499, 2), "right");
  assert.equal(blinkSideAt(500, 2), "left");
  assert.equal(blinkSideAt(1000, 2), "right");
  assert.equal(blinkSideAt(-10, 2), "right");
  console.log("PASS Blink: hız 0,5–3 Hz arasına kilitleniyor, taraflar eşit süre dönüşümlü.");
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
