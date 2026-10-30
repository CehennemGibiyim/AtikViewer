/**
 * PACS / DICOMweb istemcisi entegrasyon testi (gerçek HTTP, mock PACS sunucusu).
 *
 * Çalıştırma: npm run test:pacs
 * Kapsadıkları: Basic kimlik doğrulama, QIDO parametreleri + JSON ayrıştırma,
 * 204 boş sonuç, 404/401 için Türkçe hata eşlemesi, WADO multipart ayrıştırma,
 * "Bağlantıyı test et" uç adım raporu.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { friendlyStatus, qidoInstances, qidoStudies, testConnection, wadoInstance } from "../src/lib/server/pacs";
import type { PacsConfig } from "../src/lib/pacsPresets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Mock sunucu hazır olduğunda gerçek portu bu değerden okuruz (port 0 ile başlar). */
let ROOT = "";

function cfg(over: Partial<PacsConfig> = {}): PacsConfig {
  return {
    name: "Mock PACS",
    kind: "custom",
    qidoRoot: ROOT,
    wadoRoot: "",
    auth: { type: "basic", username: "atik", password: "atik123", token: "", headerName: "", headerValue: "" },
    allowSelfSigned: false,
    limit: 50,
    includefield: true,
    notes: "",
    ...over,
  };
}

async function waitForReady(child: ChildProcess, ms = 8000): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock PACS hazır olmadı")), ms);
    child.stdout?.on("data", (b: Buffer) => {
      const m = /mock-pacs-ready (\d+)/.exec(b.toString());
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    });
    child.on("exit", () => {
      clearTimeout(t);
      reject(new Error("mock PACS erken kapandı"));
    });
  });
}

const errOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, "mockPacsServer.cjs"), "0"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", (b: Buffer) => process.stderr.write(b));
  const port = await waitForReady(child);
  ROOT = `http://127.0.0.1:${port}/dicom-web`;

  try {
    // 1) QIDO-RS hasta araması — kimlik doğru, alanlar ayrıştırılıyor
    const studies = await qidoStudies(cfg(), "yilmaz");
    assert.equal(studies.length, 1, "1 çalışma bekleniyordu");
    assert.equal(studies[0].patientName, "YILMAZ AHMET", "PatientName (AİLE^AD) DICOM PN kuralına göre boşlukla yazılır");
    assert.equal(studies[0].patientId, "P123456");
    assert.equal(studies[0].modalities, "CT/SR");
    assert.equal(studies[0].instances, 2);
    assert.ok(studies[0].studyUid.startsWith("1.2.840"), "StudyInstanceUID geçerli olmalı");
    console.log("PASS QIDO arama + alan ayrıştırma");

    // 2) Boş sonuç (204) diziye çevriliyor
    assert.deepEqual(await qidoStudies(cfg(), "yok"), [], "204 boş dizi olmalı");
    console.log("PASS 204 No Content → []");

    // 3) Kimlik yok/yanlış → 401 ve Türkçe, ayırt edilebilir mesaj
    const e401 = await errOf(qidoStudies(cfg({ auth: { type: "none", username: "", password: "", token: "", headerName: "", headerValue: "" } }), "yilmaz"));
    assert.match(e401, /401/, "401 bildirilmeli");
    assert.match(e401, /[Kk]imlik/, "mesaj kimlik doğrulamayı işaret etmeli");
    assert.match(e401, /parola|token/, "mesaj neyin düzeltileceğini söylemeli");
    console.log("PASS 401 → Türkçe kimlik hatası");

    // 4) Yanlış yol → 404 mesajı adres uyarısı vermeli
    const e404 = await errOf(qidoStudies(cfg({ qidoRoot: `${new URL(ROOT).origin}/yanlis` }), "x"));
    assert.match(e404, /404/, "404 bildirilmeli");
    assert.match(e404, /taban URL|yol/i, "mesaj adres/yol uyarısı içermeli");
    console.log("PASS 404 → taban URL uyarısı");

    // 5) QIDO parametresi zorunlulukları (limit gönderiliyor)
    const nolimit = await errOf(qidoStudies(cfg({ includefield: false }), "yilmaz"));
    assert.equal(nolimit, "", "limit gönderildiği için 400 dönmemeli");
    console.log("PASS QIDO limit parametresi");

    // 6) Instance listesi + WADO-RS multipart ayrıştırma
    const inst = await qidoInstances(cfg(), "1.2.840.113619.2.55.3.604688119.868.1699000000.1");
    assert.equal(inst.length, 2);
    assert.ok(inst[0].seriesUid && inst[0].sopUid);
    const bytes = await wadoInstance(cfg(), "1.2.840.113619.2.55.3.604688119.868.1699000000.1", inst[0].seriesUid, inst[0].sopUid);
    assert.ok(bytes.length > 132, "DICOM gövdesi gelmeli");
    assert.equal(Buffer.from(bytes.subarray(128, 132)).toString("latin1"), "DICM", "Part-10 DICM imzası korunmalı");
    console.log("PASS WADO multipart → DICOM parçası");

    // 7) Bağlantı testi adımları
    const good = await testConnection(cfg());
    assert.equal(good.ok, true, "sağlıklı bağlantıda test geçmeli");
    assert.ok(good.steps.length >= 2, "en az OPTIONS + arama adımı olmalı");
    assert.ok(good.steps.every((s) => s.ok), `adımlar: ${good.steps.map((s) => `${s.name}=${s.ok}`).join(", ")}`);
    const bad = await testConnection(cfg({ auth: { type: "none", username: "", password: "", token: "", headerName: "", headerValue: "" } }));
    assert.equal(bad.ok, false, "kimliksiz bağlantı testi geçmemeli");
    assert.ok(bad.steps.some((s) => /401/.test(String(s.http))));
    console.log("PASS Bağlantı testi adım raporu (olumlu + 401)");

    // 8) Durum eşleme sözlüğü
    assert.match(friendlyStatus(401), /Kimlik/);
    assert.match(friendlyStatus(403), /red|yetki/i);
    assert.match(friendlyStatus(404), /bulunamad/i);
    assert.match(friendlyStatus(406), /içerik tür/i);
    console.log("PASS friendlyStatus eşlemesi");

    console.log("\nPACS testleri tamamlandı: 8/8");
  } finally {
    child.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
