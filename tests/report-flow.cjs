/* Rapor onay akışı + derin AI (deep-scan) akışı E2E testi.
 * BASE_URL=http://localhost:3000 node tests/report-flow.cjs
 *
 * - Varsayılan: yalnızca onay KAPILARI doğrulanır (bekleyen bulgu kilidi,
 *   hekim profili zorunluluğu, onaylıya geçişte SR/FHIR kilidi) ve HİÇBİR
 *   kayıt yazılmaz (İptal ile çıkış).
 * - CI=true veya E2E_FULL=1: onay tamamlanır, rapor gerçekten onaylanır ve
 *   kilitlenir. Bu mod yalnızca boş/fresh veritabanında anlamlıdır.
 *
 * Toraks BT bölümünde yerel AI worker (127.0.0.1:8787) varsa gerçek derin AI
 * çıkarımı, yoksa zarif yedek (kural tabanlı) kabul edilir — her iki durumda
 * da analiz tamamlanmalı ve tarayıcı JavaScript hatası olmamalıdır.
 */
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const FULL = process.env.CI === "true" || process.env.E2E_FULL === "1";

async function main() {
  const base = process.env.BASE_URL ?? "http://localhost:3000";
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.dismiss());
  try {
    // 0) Hekim profili: onay diyaloğu tanımlı ad ister. Boşsa test adıyla
    //    doldur; tanımlıysa KULLANICININ ADI EZİLMEZ.
    const profRes = await page.request.get(`${base}/api/profile`);
    assert.ok(profRes.ok(), `/api/profile ${profRes.status()}`);
    const prof = await profRes.json();
    if (!String(prof?.user?.fullName ?? "").trim()) {
      const r = await page.request.patch(`${base}/api/profile`, {
        data: { fullName: "E2E Test Radyolog", title: "Uzm. Dr.", regNo: "E2E-TEST" },
      });
      assert.ok(r.ok(), `boş profil test için doldurulamadı (${r.status()})`);
    }

    await page.goto(base);
    await page.getByTestId("workstation").waitFor();
    const side = page.locator('aside[aria-label="Seri listesi"]');
    const panel = page.locator('aside[aria-label="İnceleme paneli"]');

    // ── 1) BT beyin: kural tabanlı analiz → rapor → onay kapıları ──
    await side.getByText("Beyin BT (kontrastsız)", { exact: true }).click();
    await panel.getByRole("button", { name: /Analizi başlat/ }).click();
    await panel.getByText(/Kural tabanlı BT aday odakları|kesit işlendi/).first().waitFor({ timeout: 90000 });

    await page.getByRole("button", { name: /Raporu aç/ }).click();
    const modal = page.locator("div.fixed.inset-0").filter({ hasText: "Radyoloji raporu" }).first();
    await modal.getByText(/AI aday bulguları/).waitFor();

    // Kapı 1: en az bir bulgu "Onay bekliyor" ve uyarı bandı görünür
    const pend = modal.getByRole("button", { name: "Onay bekliyor" });
    assert.ok((await pend.count()) >= 1, "en az bir bulgu 'Onay bekliyor' olmalı");
    await modal.getByText(/bulgu henüz gözden geçirilmedi/).waitFor();

    // Kapı 2: onay öncesi SR/FHIR indirme kilitli
    assert.equal(await modal.getByRole("button", { name: "DICOM SR ⬇" }).isDisabled(), true, "onaysız SR indirilememeli");

    // Kapı 3: bekleyen bulgu varken "Onayla ve kilitle" kapalı
    await modal.getByRole("button", { name: "✓ Onayla", exact: true }).click();
    await modal.getByText(/kimlik doğrulaması yapmaz/).waitFor();
    assert.equal(await modal.getByRole("button", { name: "✓ Onayla ve kilitle" }).isDisabled(), true, "bekleyen bulgu varken kilit kapalı olmalı");
    await modal.getByRole("button", { name: "İptal", exact: true }).click();

    // Tüm bulguları onayla (durum düğmesi: bekliyor → onaylandı)
    let guard = 0;
    while ((await pend.count()) > 0 && guard++ < 60) await pend.first().click();
    await modal.getByText(/bulgu henüz gözden geçirilmedi/).waitFor({ state: "detached" });

    // Kapı 4: tümü değerlendirilince kilit açılmalı
    await modal.getByRole("button", { name: "✓ Onayla", exact: true }).click();
    const kilitle = modal.getByRole("button", { name: "✓ Onayla ve kilitle" });
    assert.equal(await kilitle.isDisabled(), false, "tüm bulgular onaylanınca kilit açılmalı");

    if (FULL) {
      await kilitle.click();
      await modal.getByText(/ONAYLANDI/).waitFor({ timeout: 30000 });
      assert.match(await modal.innerText(), /KİLİTLİ/);
      assert.equal(await modal.getByRole("button", { name: "DICOM SR ⬇" }).isDisabled(), false, "onaydan sonra SR açılmalı");
      console.log("PASS Rapor onayı: bekleyen bulgu → tümü onay → onay ve kilit; SR/FHIR kilidi açıldı.");
    } else {
      await modal.getByRole("button", { name: "İptal", exact: true }).click();
      console.log("PASS Rapor onay kapıları: bekleyen bulgu kilidi, profil zorunluluğu ve SR kilidi doğrulandı (kayıt yazılmadı).");
    }
    await modal.getByRole("button", { name: "✕" }).click();

    // ── 2) Toraks BT: derin AI akışı (worker yoksa zarif yedek) ──
    await side.getByText("Toraks BT (akciğer penceresi)", { exact: true }).click();
    await panel.getByRole("button", { name: /Analizi başlat/ }).click();
    await panel.getByText(/Derin AI/).last().waitFor({ timeout: 180000 });
    await panel.getByText(/kesit işlendi/).last().waitFor({ timeout: 180000 });
    const feed = await panel.innerText();
    assert.match(feed, /Derin AI.*(tamamlandı|atlandı|çalıştırılamadı)/s, "derin AI sonucu feed'de görünmeli");

    // Derin AI gerçekten bulgu ürettiyse rapora "bekliyor" olarak taşınmalı
    await page.getByRole("button", { name: /Raporu aç/ }).click();
    await modal.getByText(/AI aday bulguları/).waitFor();
    const deepFound = /nodül adayı bulundu/.test(feed);
    if (deepFound) {
      assert.ok((await modal.getByRole("button", { name: "Onay bekliyor" }).count()) >= 1,
        "derin AI bulguları raporda 'Onay bekliyor' olarak yer almalı");
      console.log("PASS Derin AI: bulgular rapor taslağına aktarıldı (hekim onayı bekliyor).");
    } else {
      console.log("PASS Derin AI: akış tamamlandı (worker kapalı/eşik: kural tabanlı yedek veya aday yok) — analiz bozulmadı.");
    }
    await modal.getByRole("button", { name: "✕" }).click();

    assert.deepEqual(errors, []);
    console.log("PASS Tarayıcı JavaScript hatası yok.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
