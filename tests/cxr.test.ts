import assert from "node:assert/strict";
import { buildCxrDataset } from "./cxr-dataset";
import { CXR_THRESHOLDS, cxrEligible, runChestXray } from "../src/lib/ai/chestXray";
import { cxrGate, type CxrCategoryMetrics } from "../src/lib/ai/cxrValidation";
import { CXR_VALIDATION_REPORT } from "../src/lib/ai/cxrValidationData";
import { resolveProtocol } from "../src/lib/ai/engine";
import { buildSampleCase } from "../src/lib/sampleCases";

const hooks = { aborted: () => false, onSlice: async () => {} };

async function main() {
  // 1) Uygunluk ve protokol yönlendirmesi
  const cr = buildSampleCase("cr-chest")!;
  assert.equal(cxrEligible(cr), null);
  assert.equal(resolveProtocol(cr, "auto"), "cxr");
  assert.equal(resolveProtocol({ ...cr, modality: "MR" }, "auto"), "image-review");
  assert.match(cxrEligible({ ...cr, modality: "CT" }) ?? "", /CR\/DX/);
  console.log("PASS Uygunluk: CR/DX akciğer grafisi dedektörüne yönleniyor; MR/BT yönlenmiyor.");

  const ds = buildCxrDataset(4242, 2, 2);

  // 2) Normal grafi: aday bulgu üretilmez, yalnızca nicel ölçüm kartı gelir
  const normal = ds.find((c) => Object.values(c.labels).every((v) => !v))!;
  const nOut = await runChestXray(normal.series, hooks);
  assert(nOut);
  const nAbnormal = nOut.findings.filter((f) => f.category !== "Sistem");
  assert.equal(nAbnormal.length, 0, `normal grafi de aday bulgu olmamalı: ${nAbnormal.map((f) => f.label).join(", ")}`);
  const measureCard = nOut.findings.find((f) => f.category === "Sistem");
  assert(measureCard, "nicel ölçüm kartı bekleniyordu");
  assert.match(measureCard.detail, /KTO/);
  console.log(`PASS Normal grafi: 0 aday bulgu · ${measureCard.densityOrSignal}`);

  // 3) Aday bulgular: ölçüm var, kutu var, doğrulama metni var
  const conCases = ds.filter((c) => c.labels["Konsolidasyon"]);
  let conFound = 0;
  let lastLabel = "";
  for (const c of conCases) {
    const out = await runChestXray(c.series, hooks);
    assert(out);
    const hit = out.findings.find((f) => f.category === "Konsolidasyon");
    if (hit) {
      conFound++;
      lastLabel = `${hit.label} · ${hit.sizeMmStr}`;
      assert(hit.bbox, "aday bulguda sınır kutusu bekleniyordu");
      assert.match(hit.detail, /duyarlılık %/);
      assert.match(hit.detail, /ADAY BULGUDUR/);
      assert.equal(hit.source, "cv-heuristic");
      assert.equal(hit.confidenceKind, "heuristic");
      assert(hit.severity === "dusuk" || hit.severity === "orta", "sentetik doğrulamada öncelik 'orta'yı aşmamalı");
    }
  }
  assert(conFound > 0, `${conCases.length} konsolidasyon vakasının hiçbirinde aday bulunamadı`);
  console.log(`PASS Konsolidasyon: ${conFound}/${conCases.length} vakada aday bulgu (${lastLabel}).`);

  // 4) Doğrulama kapısı: ölçüm yoksa veya performans düşükse bulgu gösterilmez
  const emptyReport = { ...CXR_VALIDATION_REPORT, categories: {} };
  const noMetrics = cxrGate("Konsolidasyon", emptyReport);
  assert.equal(noMetrics.unlocked, false);
  assert.match(noMetrics.reason, /ölçümü yok/);

  const weak: CxrCategoryMetrics = {
    positives: 20, negatives: 120, tp: 2, fp: 0, tn: 120, fn: 18,
    sensitivity: 0.1, specificity: 1,
    sensitivity95: { low: 0.03, high: 0.3 }, specificity95: { low: 0.97, high: 1 },
  };
  const weakGate = cxrGate("Konsolidasyon", { ...CXR_VALIDATION_REPORT, categories: { Konsolidasyon: weak } });
  assert.equal(weakGate.unlocked, false);
  assert.match(weakGate.reason, /duyarlılık çok düşük/);

  const tiny: CxrCategoryMetrics = { ...weak, positives: 3, sensitivity: 1, tp: 3, fn: 0 };
  const tinyGate = cxrGate("Konsolidasyon", { ...CXR_VALIDATION_REPORT, categories: { Konsolidasyon: tiny } });
  assert.equal(tinyGate.unlocked, false);
  assert.match(tinyGate.reason, /örneklemi yetersiz/);
  console.log("PASS Doğrulama kapısı: ölçümsüz, düşük duyarlılıklı ve küçük örneklemli tipler bulgu olarak gösterilmiyor.");

  // 5) Yayınlanan rapor tüm kategorileri ölçmüş olmalı (aksi hâlde arayüz kilitli kalır)
  for (const category of ["Kardiyomegali", "Plevral efüzyon", "Konsolidasyon", "Pnömotoraks", "Nodül"] as const) {
    const gate = cxrGate(category);
    const m = gate.metrics;
    assert(m, `${category} için ölçüm yok — npm run validate:cxr çalıştırın`);
    console.log(
      `  ${category.padEnd(16)} kapı ${gate.unlocked ? "AÇIK " : "KAPALI"} · duyarlılık %${Math.round(m.sensitivity * 100)} · özgüllük %${Math.round(m.specificity * 100)} (n=${m.positives})`,
    );
  }
  assert.equal(CXR_VALIDATION_REPORT.dataset.cases > 0, true);
  assert.equal(CXR_THRESHOLDS.ctrUpperLimit, 0.5);

  // 6) İptal
  const canceled = await runChestXray(conCases[0].series, { aborted: () => true, onSlice: async () => {} });
  assert.equal(canceled, null);
  console.log("PASS İptal: tarama durduruluyor, sonuç uygulanmıyor.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
