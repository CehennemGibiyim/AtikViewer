/* Çalıştırma: NODE_PATH=<Playwright kurulu dizin>/node_modules node tests/menu-interactions.cjs
 * Uygulama production olarak çalışmalı. Veritabanını sıfırlamaz; hesap/rapor silmez.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const checks = [];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "atik-menu-"));

async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

async function waitReady(page, root = page) {
  await root.getByTestId("workstation").waitFor();
  await root.locator('aside[aria-label="Seri listesi"] button').first().waitFor();
}

async function chooser(page, root, name) {
  const pending = page.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null);
  await root.getByLabel(name, { exact: true }).click();
  const result = await pending;
  assert(result, `${name}: yerel dosya seçici açılmadı`);
  return result;
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  let server;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE);
    await waitReady(page);

    const png = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 72; c.height = 72;
      const x = c.getContext("2d");
      const grad = x.createLinearGradient(0, 0, 72, 72); grad.addColorStop(0, "red"); grad.addColorStop(1, "blue");
      x.fillStyle = grad; x.fillRect(0, 0, 72, 72);
      return c.toDataURL("image/png").split(",")[1];
    });
    fs.writeFileSync(path.join(temp, "MENU-FIXTURE.png"), Buffer.from(png, "base64"));
    fs.writeFileSync(path.join(temp, "README.txt"), "Test fixture folder");

    await check("1280px: tüm üst menü ekrana sığıyor", async () => {
      const g = await page.locator('header[aria-label="Ana işlemler"]').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert(g.scroll <= g.client + 2, JSON.stringify(g));
      for (const name of ["MPR", "PNG", "Oto-düzen"]) {
        const box = await page.getByRole("button", { name, exact: true }).boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= 1282, `${name} ekran dışında`);
      }
    });

    await check("Dosya aç: seçici + gerçek PNG içe aktarma", async () => {
      const fc = await chooser(page, page, "Dosya aç");
      await fc.setFiles(path.join(temp, "MENU-FIXTURE.png"));
      await page.locator('aside[aria-label="Seri listesi"] [title="MENU-FIXTURE"]').first().waitFor();
      assert.equal(await page.getByRole("status", { name: "Dosya yükleme ilerlemesi" }).count(), 0);
    });

    await check("Klasör aç: directory seçici + klasör dosyalarının içe aktarılması", async () => {
      const fc = await chooser(page, page, "Klasör aç");
      assert.notEqual(await fc.element().getAttribute("webkitdirectory"), null);
      await fc.setFiles(temp);
      await page.getByTestId("action-feedback").filter({ hasText: /seri açıldı/ }).waitFor();
    });

    const selectBrain = async () => {
      await page.locator('aside[aria-label="Seri listesi"]').getByText("Beyin BT (kontrastsız)", { exact: true }).click();
    };
    await selectBrain();

    await check("Oto-düzen: durum değişir ve beyin/kemik panelleri uygulanır", async () => {
      const button = page.getByRole("button", { name: "Oto-düzen", exact: true });
      if (await button.getAttribute("aria-pressed") === "true") await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "false");
      await page.getByLabel("Izgara düzeni").selectOption("2x2");
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByLabel("Izgara düzeni").inputValue(), "1x2");
      assert.equal(await page.getByTestId("reference-panel").count(), 1);
    });

    await check("MPR: üç düzlem açılır ve Escape ile kapanır", async () => {
      await page.getByRole("button", { name: "MPR", exact: true }).click();
      await page.getByText("AKSİYEL", { exact: true }).waitFor();
      assert.equal(await page.getByText("KORONAL", { exact: true }).count(), 1);
      assert.equal(await page.getByText("SAGİTAL", { exact: true }).count(), 1);
      await page.keyboard.press("Escape");
      await page.getByText("AKSİYEL", { exact: true }).waitFor({ state: "detached" });
    });

    await check("PNG: önizleme açılır, indirme gerçek dosya üretir", async () => {
      await page.getByRole("button", { name: "PNG", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "PNG görüntü önizlemesi" });
      await dialog.waitFor();
      await page.waitForFunction(() => document.querySelector('a[download="kesit-14.png"]')?.getAttribute("href")?.startsWith("blob:"));
      const event = page.waitForEvent("download");
      await dialog.getByRole("link", { name: "PNG dosyasını indir" }).click();
      const dl = await event;
      assert.equal(dl.suggestedFilename(), "kesit-14.png");
      const filename = await dl.path();
      assert.equal(fs.readFileSync(filename).subarray(1, 4).toString(), "PNG");
      await dialog.getByRole("button", { name: "PNG önizlemesini kapat" }).click();
      await dialog.waitFor({ state: "detached" });
    });

    await check("Sekmeler: DICOM, Ölçüm ve Vision AI arasında geçiş", async () => {
      const panel = page.locator('aside[aria-label="İnceleme paneli"]');
      await panel.getByRole("button", { name: "DICOM", exact: true }).click();
      assert(await panel.locator("table").count());
      await panel.getByRole("button", { name: /^Ölçüm/ }).click();
      assert(await panel.getByText("Anahtar kesitler (0)", { exact: true }).count());
      await panel.getByRole("button", { name: "Vision AI", exact: true }).click();
      assert(await panel.getByRole("button", { name: /Analizi başlat/ }).count());
    });

    await check("Protokol editörü: 2×2 özel kural kaydedilir ve uygulanır", async () => {
      await page.getByRole("button", { name: /Protokoller/ }).click();
      const dlg = page.getByRole("dialog", { name: "Kullanıcı Tanımlı Asma Protokolü Editörü" });
      await dlg.getByRole("button", { name: /Yeni Protokol Ekle/ }).click();
      await dlg.locator('input[type="text"]').first().fill("Menü testi — BT beyin 4 panel");
      await dlg.locator("select").first().selectOption("2x2");
      assert.equal(await dlg.getByText("Panel 4 (Hücre 3)", { exact: true }).count(), 1);
      await dlg.getByRole("button", { name: /Değişiklikleri Kaydet/ }).click();
      await dlg.getByRole("button", { name: /Şimdi Uygula/ }).click();
      assert.equal(await page.getByLabel("Izgara düzeni").inputValue(), "2x2");
      assert.equal(await page.getByTestId("reference-panel").count(), 3);
    });

    await check("960px: menü ve sekmeler gizlenmeden kullanılabilir", async () => {
      await page.setViewportSize({ width: 960, height: 800 });
      const g = await page.locator('header[aria-label="Ana işlemler"]').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert(g.scroll <= g.client + 2, JSON.stringify(g));
      await page.getByRole("button", { name: /Protokoller/ }).click();
      await page.getByRole("dialog", { name: "Kullanıcı Tanımlı Asma Protokolü Editörü" }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
    });

    assert.deepEqual(errors, [], "Normal kullanımda JavaScript hataları");
    await ctx.close();

    for (const kind of ["malformed", "storage-denied", "cancel-import"]) {
      const c = await browser.newContext({ viewport: { width: 1280, height: 850 } });
      const p = await c.newPage(); p.setDefaultTimeout(10000);
      const errors = []; p.on("pageerror", (e) => errors.push(e.message));
      if (kind === "malformed") await c.addInitScript(() => {
        localStorage.setItem("atik_presets", "null");
        localStorage.setItem("atik_user_hanging_protocols", "{}");
      });
      if (kind === "storage-denied") await c.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } }));
      if (kind === "cancel-import") await c.addInitScript(() => {
        const original = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = function () { return this.name.startsWith("HANG") ? new Promise(() => {}) : original.call(this); };
      });
      await p.goto(BASE); await waitReady(p);
      await check(`${kind}: arayüz ve Protokoller çalışır`, async () => {
        await p.getByRole("button", { name: /Protokoller/ }).click();
        await p.getByRole("dialog", { name: "Kullanıcı Tanımlı Asma Protokolü Editörü" }).waitFor();
        await p.getByRole("button", { name: "Protokol penceresini kapat" }).click();
        await p.getByRole("dialog").waitFor({ state: "detached" });
      });
      if (kind === "cancel-import") await check("Takılan dosya yüklemesi menüleri engellemez ve iptal edilebilir", async () => {
        await p.getByLabel("Dosya aç", { exact: true }).setInputFiles({ name: "HANG.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
        await p.getByRole("status", { name: "Dosya yükleme ilerlemesi" }).waitFor();
        await p.locator('aside[aria-label="İnceleme paneli"]').getByRole("button", { name: "DICOM", exact: true }).click();
        assert.equal(await p.locator('aside[aria-label="İnceleme paneli"] table').count(), 1);
        await p.getByRole("button", { name: "Yüklemeyi iptal et" }).click();
        await p.getByRole("status", { name: "Dosya yükleme ilerlemesi" }).waitFor({ state: "detached" });
        await p.getByRole("button", { name: /Protokoller/ }).click();
        await p.getByRole("dialog").waitFor();
        await p.keyboard.press("Escape");
      });
      assert.deepEqual(errors, [], `${kind} JavaScript hataları`);
      await c.close();
    }

    server = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(`<iframe title="Önizleme" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" src="${BASE}" style="border:0;width:100vw;height:100vh"></iframe>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const cc = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    const pp = await cc.newPage(); pp.setDefaultTimeout(10000);
    const frameErrors = []; pp.on("pageerror", (e) => frameErrors.push(e.message));
    await pp.goto(`http://127.0.0.1:${server.address().port}`);
    const frame = pp.frameLocator("iframe");
    await waitReady(pp, frame);
    await check("Sandbox iframe: Dosya/Klasör seçicileri ve PNG önizleme çalışır", async () => {
      assert(await chooser(pp, frame, "Dosya aç"));
      assert(await chooser(pp, frame, "Klasör aç"));
      await frame.getByRole("button", { name: "PNG", exact: true }).click();
      await frame.getByRole("dialog", { name: "PNG görüntü önizlemesi" }).waitFor();
      assert.equal(await frame.getByRole("link", { name: /yeni sekmede aç/ }).count(), 1);
      await frame.getByRole("button", { name: "PNG önizlemesini kapat" }).click();
    });
    assert.deepEqual(frameErrors, [], "iframe JavaScript hataları");
    await cc.close();
    console.log(`\n${checks.length} kontrol başarılı; arayüz, dosya seçimi, indirme ve hata senaryoları doğrulandı.`);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await browser.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
