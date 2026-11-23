import assert from "node:assert/strict";
import { buildSampleCase } from "../src/lib/sampleCases";
import { resolveProtocol } from "../src/lib/ai/engine";
import { runImageReview } from "../src/lib/ai/imageReview";
import type { SeriesData } from "../src/lib/types";

async function main() {
  const us = buildSampleCase("us-color-doppler")!;
  assert.equal(resolveProtocol(us, "auto"), "image-review");
  let count = 0;
  const doppler = await runImageReview(us, { aborted: () => false, onSlice: async (_i, n) => { count++; assert.equal(n, 12); } });
  assert(doppler);
  assert.equal(count, 12);
  assert.equal(doppler.review.frameCount, 12);
  assert.equal(doppler.review.frames.length, 12);
  assert.equal(doppler.review.mode, "color");
  assert(doppler.review.frames.some((f) => (f.redCoverage ?? 0) > 0));
  assert(doppler.review.frames.some((f) => (f.blueCoverage ?? 0) > 0));
  assert(doppler.review.frames.some((f) => !!f.colorBox));
  assert(doppler.findings.length > 0);
  assert(doppler.findings.every((f) => f.severity === "normal" && f.confidenceKind === "none" && f.source === "image-review"));
  assert(!doppler.findings.some((f) => /tromb|darl|stenoz|kanama|acil/i.test(f.label)));
  console.log(`PASS US renkli Doppler: 12/12 kare, kırmızı/mavi alan, tanısal bulgu yok. Anahtar kareler: ${doppler.review.keyFrames.map((n) => n + 1).join(", ")}`);

  for (const id of ["mr-brain", "cr-chest"] as const) {
    const sample = buildSampleCase(id)!;
    // Yüklenen gerçek hastada önceden kodlanmış DEMO bulgular yoktur.
    const realStyle: SeriesData = { ...sample, isSample: false, lesions: [] };
    assert.equal(resolveProtocol(realStyle, "auto"), "image-review");
    const review = await runImageReview(realStyle, { aborted: () => false, onSlice: async () => {} });
    assert(review);
    assert.equal(review.review.frameCount, realStyle.slices.length);
    assert.equal(review.review.mode, "grayscale");
    assert(review.review.frames.every((f) => Number.isFinite(f.mean) && Number.isFinite(f.std)));
    assert(review.findings.every((f) => f.severity === "normal"));
    console.log(`PASS ${realStyle.modality}: ${review.review.frameCount} kare ölçüldü; hastalık sınıflandırması yapılmadı.`);
  }

  const ct = buildSampleCase("ct-brain")!;
  assert.equal(resolveProtocol(ct, "auto"), "ct-head");
  assert.equal(resolveProtocol(ct, "review"), "image-review");
  assert.equal(resolveProtocol(ct, "none"), "none");
  assert.equal(resolveProtocol({ ...ct, description: "ABDOMEN", bodyPart: "ABDOMEN" }, "auto"), "image-review");
  console.log("PASS BT: beyin için tanımlı aday motoru korunur; abdomen ve elle seçimde görüntü ölçümü çalışır.");

  const blank: SeriesData = { ...us, id: "blank", modality: "MG", isColor: false, rgbaSlices: undefined, slices: [new Int16Array(us.width * us.height).fill(42)], lesions: [] };
  const neutral = await runImageReview(blank, { aborted: () => false, onSlice: async () => {} });
  assert(neutral);
  assert.equal(neutral.review.frames[0].mean, 42);
  assert.equal(neutral.review.frames[0].std, 0);
  assert.equal(neutral.review.frames[0].contrast, 0);
  assert(neutral.findings.every((f) => f.severity === "normal" && f.confidence === 0));
  console.log("PASS Tek kare/boş görüntü: ölçüm yapılır, sahte normal veya hastalık sonucu verilmez.");

  const hundred: SeriesData = {
    ...blank,
    id: "hundred-frame-test",
    modality: "MG",
    slices: Array.from({ length: 100 }, (_, i) => new Int16Array(64 * 64).fill(42 + (i % 8))),
    width: 64, height: 64,
  };
  let scanned = 0;
  const hundredResult = await runImageReview(hundred, { aborted: () => false, onSlice: async () => { scanned++; } });
  assert(hundredResult);
  assert.equal(scanned, 100);
  assert.equal(hundredResult.review.frames.length, 100);
  assert.deepEqual(hundredResult.review.frames.map((f) => f.sliceIndex), Array.from({ length: 100 }, (_, i) => i));
  console.log("PASS 100 kare: 1–100 arasındaki tüm kareler sırayla ölçülür, atlanan kare yok.");

  let cancelled = false;
  const canceled = await runImageReview(us, { aborted: () => cancelled, onSlice: async () => { cancelled = true; } });
  assert.equal(canceled, null);
  console.log("PASS İptal: tarama durduruluyor ve eski sonuç uygulanmıyor.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
