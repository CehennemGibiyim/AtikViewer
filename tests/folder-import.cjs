/* Klasör yükleme regresyon testi.
 * Çalıştırma: NODE_PATH=<playwright>/node_modules node tests/folder-import.cjs
 * İsteğe bağlı gerçek DICOM klasörleri: DICOM_DIRS="/yol/cd1:/yol/cd2"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atik-folder-"));
const mk = (rel, content) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };

// Desteklenmeyen biçim: yalnızca başlığı olan, MPEG-4 aktarım sözdizimli küçük bir DICOM üret.
function fakeMpegDicom() {
  const el = (g, e, vr, val) => {
    const b = Buffer.from(val.length % 2 ? val + "\0" : val, "latin1");
    const h = Buffer.alloc(8); h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, "latin1"); h.writeUInt16LE(b.length, 6);
    return Buffer.concat([h, b]);
  };
  const meta = Buffer.concat([el(2, 0x10, "UI", "1.2.840.10008.1.2.4.102")]);
  const len = Buffer.alloc(12); len.writeUInt16LE(2, 0); len.writeUInt16LE(0, 2); len.write("UL", 4, "latin1"); len.writeUInt16LE(4, 6); len.writeUInt32LE(meta.length, 8);
  const body = Buffer.concat([el(8, 0x60, "CS", "XC"), el(0x28, 0x10, "US", "\x10\x00"), el(0x28, 0x11, "US", "\x10\x00")]);
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), len, meta, body, Buffer.alloc(200)]);
}

async function upload(page, dir) {
  const fcP = page.waitForEvent("filechooser", { timeout: 6000 });
  await page.getByLabel("Klasör aç", { exact: true }).click();
  const fc = await fcP;
  assert.notEqual(await fc.element().getAttribute("webkitdirectory"), null, "webkitdirectory yok");
  await fc.setFiles(dir);
}

(async () => {
  const empty = path.join(tmp, "bos"); fs.mkdirSync(empty);
  mk("tibbi-olmayan/AUTORUN.INF", "[autorun]"); mk("tibbi-olmayan/README.txt", "x".repeat(300)); mk("tibbi-olmayan/viewer.bin", Buffer.alloc(4096, 7));
  mk("desteklenmeyen/DICOM/IM0001", fakeMpegDicom());
  const b = await chromium.launch({ args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 850 } });
  p.setDefaultTimeout(15000);
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE);
  await p.locator('aside[aria-label="Seri listesi"] button').first().waitFor();
  const dialog = () => p.getByRole("dialog", { name: /görüntü açılamadı|Yükleme raporu/ });

  // Bu test klasik webkitdirectory yolunu sınar; üst düzey Chromium'da uygulama
  // showDirectoryPicker çağırdığı için API geçici olarak kaldırılır (gömülü önizleme yolu).
  await p.evaluate(() => { delete window.showDirectoryPicker; });

  // Boş klasörde webkitdirectory 0 dosya verir; Playwright boş dizini setFiles ile veremediği için
  // değişiklik olayı doğrudan gizli <input webkitdirectory> üzerine tetiklenir.
  await p.locator('input[type="file"][webkitdirectory]').evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
  await dialog().waitFor();
  assert.match(await dialog().innerText(), /boş görünüyor/);
  await p.getByRole("button", { name: "Tamam" }).click();
  console.log("PASS boş klasör: sessiz kalmıyor, rapor gösteriyor");

  await upload(p, path.join(tmp, "tibbi-olmayan"));
  await dialog().waitFor();
  const t1 = await dialog().innerText();
  assert.match(t1, /DICOM dosyası bulunamadı/); assert.match(t1, /Açılan seri \/ nesne\s*0/);
  await p.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" });
  console.log("PASS tıbbi olmayan klasör: neden ve öneri gösteriliyor");

  await upload(p, path.join(tmp, "desteklenmeyen"));
  await dialog().waitFor();
  assert.match(await dialog().innerText(), /Desteklenmeyen sıkıştırma biçimi[\s\S]*MPEG/);
  await p.getByRole("button", { name: "Yükleme raporunu kapat" }).click();
  console.log("PASS desteklenmeyen biçim: biçim adı ve dosya sayısı raporlanıyor");

  for (const dir of (process.env.DICOM_DIRS || "").split(":").filter(Boolean)) {
    const before = await p.locator('aside[aria-label="Seri listesi"] button:has(canvas)').count();
    const t0 = Date.now();
    await upload(p, dir);
    const countFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(d, e.name)) : 1), 0);
    await p.getByTestId("action-feedback").filter({ hasText: new RegExp(`^${countFiles(dir)} dosyadan \\d+ seri açıldı`) }).waitFor({ timeout: 120000 });
    const after = await p.locator('aside[aria-label="Seri listesi"] button:has(canvas)').count();
    assert(after > before, `${dir}: seri açılmadı`);
    await p.getByRole("button", { name: /^Yükleme raporu:/ }).click();
    await dialog().waitFor(); await p.keyboard.press("Escape");
    console.log(`PASS ${dir}: ${after - before} seri, ${((Date.now() - t0) / 1000).toFixed(1)} sn, rapor düğmesi çalışıyor`);
  }
  assert.deepEqual(errors, [], "JavaScript hataları");
  await b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\nKlasör yükleme testleri başarılı.");
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exitCode = 1; });
