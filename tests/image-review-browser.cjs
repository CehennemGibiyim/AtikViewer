/* Run after npm run build + build_and_start:
 * BASE_URL=http://localhost:3000 NODE_PATH=/tmp/atik-review-browser/node_modules node tests/image-review-browser.cjs
 * Playwright is a temporary test dependency; it is not included in the production bundle.
 */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.dismiss());
  try {
    await page.goto(process.env.BASE_URL ?? "http://localhost:3000");
    await page.getByTestId("workstation").waitFor();
    await page.locator('aside[aria-label="Seri listesi"] button:has(canvas)').first().waitFor();
    const side = page.locator('aside[aria-label="Seri listesi"]');
    const panel = page.locator('aside[aria-label="İnceleme paneli"]');

    await side.getByText("Karotis Renkli Doppler USG (Cine)", { exact: true }).click();
    await panel.getByText("Her karede gerçek piksel ölçümü", { exact: false }).waitFor();
    await panel.getByRole("button", { name: /Acil triyaj/ }).click();
    await panel.getByText(/US\/MR\/grafi için acil klinik sınıflandırıcı bağlı değil/).waitFor();
    await panel.getByRole("button", { name: /Görüntü incelemesini başlat/ }).click();
    await panel.getByText(/karede gerçek piksel incelemesi tamamlandı/).waitFor({ timeout: 30000 });
    const review = panel.getByRole("region", { name: "Kesit bazlı görüntü ölçümleri" });
    await review.waitFor();
    assert.equal(await review.locator("tbody tr").count(), 12);
    assert.equal(await review.getByRole("button", { name: /Kare \d+ görüntüsüne git/ }).count(), 12);
    assert.match(await review.innerText(), /Kırmızı/);
    assert.match(await review.innerText(), /Mavi/);
    assert.match(await panel.innerText(), /KLİNİK TRİYAJ YOK|Klinik triyaj yapılmadı/i);
    assert.doesNotMatch(await panel.innerText(), /Bu seri için tanımlı otomatik dedektör yok/);
    await review.getByRole("button", { name: "Kare 8 görüntüsüne git" }).click();
    await page.getByText("Kesit 8/12", { exact: false }).first().waitFor();
    console.log("PASS Renkli Doppler: 12/12 kare ölçüldü, renkli alanlar ve kareye atlama var; sahte acil tanı yok.");

    await panel.getByRole("button", { name: "Rapor", exact: true }).click();
    const reportText = await panel.innerText();
    assert.doesNotMatch(reportText, /Kare 1:|Kare 12:|KARE\/KESİT BAZLI GÖRÜNTÜ ÖLÇÜMLERİ/,
      "tanısal olmayan tüm kare istatistikleri rapor metnine dökülmemeli");
    assert.match(reportText, /dedektörü DEĞİLDİR|klinik izlenim radyolog tarafından yazılmalıdır/,
      "rapor, ölçümlerin tanısal olmadığını belirten uyarıyı korumalıdır");
    console.log("PASS US raporu: kare ölçümleri çıktı metninden çıkarıldı; tanısal olmadığı belirtiliyor.");

    await side.getByText("Akciğer Grafisi PA", { exact: true }).click();
    await panel.getByRole("button", { name: "Vision AI", exact: true }).click();
    await panel.locator("select").first().selectOption("review");
    await panel.getByRole("button", { name: /Görüntü incelemesini başlat/ }).click();
    await panel.getByRole("region", { name: "Kesit bazlı görüntü ölçümleri" }).waitFor({ timeout: 30000 });
    assert.equal(await panel.locator('section[aria-label="Kesit bazlı görüntü ölçümleri"] tbody tr').count(), 1);
    await panel.getByRole("button", { name: "Rapor", exact: true }).click();
    assert.doesNotMatch(await panel.innerText(), /Kesit 1: ortalama|TEMSİLÎ KARE\/KESİT GÖRÜNTÜ ÖLÇÜMLERİ/);
    // Yazdırma kâğıdı: aday bulgu kutusu olmayan ölçüm kesitleri basılmaz.
    await panel.getByRole("button", { name: "Vision AI", exact: true }).click();
    await panel.getByRole("button", { name: /Raporu aç/ }).first().click();
    const modal = page.locator("div.fixed.inset-0").filter({ hasText: "Radyoloji raporu" }).first();
    await modal.waitFor();
    assert.equal(await modal.locator("#report-paper img").count(), 0, "aday kutusu olmayan ölçüm karesi yazdırılmamalı");
    assert.doesNotMatch(await modal.innerText(), /KARE\/KESİT BAZLI GÖRÜNTÜ ÖLÇÜMLERİ|Kesit 1: ortalama/);
    await modal.getByRole("button", { name: "✕" }).first().click();
    await modal.waitFor({ state: "detached" });
    console.log("PASS CR tek kare: görüntü ölçümü panelde mevcut, rapor metnine/yazdırmaya eklenmiyor.");

    await side.getByText("Beyin BT (kontrastsız)", { exact: true }).click();
    await panel.getByRole("button", { name: /Analizi başlat/ }).click();
    await panel.getByText(/Kural tabanlı BT aday odakları/).waitFor({ timeout: 35000 });
    assert.doesNotMatch(await panel.innerText(), /Bu seri için tanımlı otomatik dedektör yok/);
    console.log("PASS BT beyin: mevcut aday odak taraması korunuyor.");
    assert.deepEqual(errors, []);
    console.log("PASS Tarayıcı JavaScript hatası yok.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
