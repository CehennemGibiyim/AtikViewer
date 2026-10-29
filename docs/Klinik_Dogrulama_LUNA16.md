# Klinik Doğrulama Raporu — GERÇEK ground-truth (LUNA16 / LIDC-IDRI)

- **Tarih:** 2026-10-29 13:53
- **Model:** C:\Users\cehen\.cache\atikviewer-ai\model\model.pt
- **Paket:** MONAI `lung_nodule_ct_detection` (LUNA16 eğitimi, Apache-2.0)
- **Cihaz:** cuda · **ROI:** (256, 256, 96) · **Çıkarım eşiği:** 0.05
- **Kohort:** 12 pozitif + 5 negatif gerçek BT serisi · 14 GT nodül · ~2084 MB indirme · kesit çapı 3.8–6.0 mm
- **Kaynak:** LUNA16 annotations (Zenodo, CC BY 4.0) · LIDC-IDRI DICOM (TCIA NBIA API, CC BY 3.0,
  [doi:10.7937/K9/TCIA.2015.LO9QL9SX](https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX))
- **Yöntem:** Her seride DICOM → HU hacmi → LUNA16 boşluğuna yeniden örnekleme → çıkarım;
  kutular orijinal kesite, oradan DICOM dünya (LPS) koordinatına çevrilir.
  **TP ölçütü (iki kademeli):** *sert* — tahmin merkezi ile GT merkezi uzaklığı ≤ yarıçap;
  *toleranslı* — ≤ çap. Bir GT'yi en fazla bir tahmin karşılar, fazladan tahmin FP'dir;
  GT'siz (negatif) serilerdeki tüm tahminler FP'dir.

## Sonuç (özet)

- Üretim eşiği **0.30**'da duyarlılık: **%92.9** (toleranslı ≤çap, 13/14) · **%57.1** (sert ≤r, 8/14) · FP/tarama **3.8**.
- **Konumlandırma:** 13/14 GT'nin en yakın ≥0.05 adayı GT merkezine 1.5–2.6 mm uzaktadır (3 mm içinde) · 12/12 pozitif seride en az bir GT toleranslı ölçütte karşılandı.
- **Kaçak:** 1/14 GT toleranslı ölçütte de kaçtı; en yakın adayı 74.1 mm uzakta ve **hiçbir skor eşiğinin altında dahi yakınında aday yok** — bu bir lokalizasyon hatasıdır. Bu nedenle "konumlandırma her vakada doğru" sonucu çıkarılamaz.
- Sert ölçütte kaçan 6 GT'nin 5 tanesi yarıçapı en fazla 1.0 mm aşan sapmayla kaçtı (konum kabaca doğru, hassasiyet sınırı); kalan 1 GT belirgin biçimde uzakta.
- Eşik duyarlılığı 0.05–0.50 arasında değişmez: toleranslı eşleşen 13 GT için en yüksek aday skoru 0.68–1.00; kaçan GT'nin ise hiç adayı yok. Üretim eşiği 0.30 duyarlılığı değil, FP/tarama yükünü düşürür.

## Eşik taraması

| Skor eşiği | Duyarlılık (sert ≤r) | Duyarlılık (toleranslı ≤çap) | FP / tarama | FP'siz negatif |
|------------|----------------------|-------------------------------|-------------|----------------|
| 0.05 | %57.1 (8/14) | %92.9 (13/14) | 7.82 | 0/5 |
| 0.10 | %57.1 (8/14) | %92.9 (13/14) | 5.88 | 0/5 |
| 0.20 | %57.1 (8/14) | %92.9 (13/14) | 4.76 | 0/5 |
| 0.30 | %57.1 (8/14) | %92.9 (13/14) | 3.82 | 0/5 |
| 0.50 | %57.1 (8/14) | %92.9 (13/14) | 2.94 | 0/5 |

## Vaka detayları

| # | Rol | Seri (son 12) | GT nodül (mm) | Kutu ≥0.05 | 0.30 TP sert/tol. | GT↔kutu (mm) | GT HU | Süre |
|---|-----|---------------|---------------|-----------|--------------------|--------------|-------|------|
| 1 | pozitif | …975654369557 | 3.8 | 5 | 0/1 (1) | 2.0 | 475.3 | 14 sn |
| 2 | pozitif | …247454313511 | 4.1 | 2 | 1/1 (1) | 1.9 | -26.3 | 48 sn |
| 3 | pozitif | …962391697338 | 5.2 | 3 | 1/1 (1) | 2.2 | -449.0 | 45 sn |
| 4 | pozitif | …286437405216 | 5.5 | 7 | 1/1 (1) | 2.1 | -5.9 | 56 sn |
| 5 | pozitif | …921686508169 | 4.1 | 10 | 0/1 (1) | 2.3 | 96.7 | 49 sn |
| 6 | pozitif | …926965850679 | 4.4 | 15 | 0/1 (1) | 2.2 | -394.1 | 62 sn |
| 7 | pozitif | …839592854574 | 5.9 | 4 | 1/1 (1) | 2.2 | -525.3 | 41 sn |
| 8 | pozitif | …109143618896 | 4.3, 6.0, 5.1 | 8 | 1/3 (2) | 2.3 · kaçan 74.1 ⚠ | -604.7, 1554.7, 773.0 | 43 sn |
| 9 | pozitif | …247348251579 | 5.0 | 7 | 0/1 (1) | 2.6 | -32.7 | 43 sn |
| 10 | pozitif | …862272696845 | 5.0 | 19 | 1/1 (1) | 1.5 | -707.2 | 44 sn |
| 11 | pozitif | …989743099991 | 5.7 | 2 | 1/1 (1) | 2.3 | -692.9 | 40 sn |
| 12 | pozitif | …712229588402 | 5.1 | 16 | 1/1 (1) | 2.3 | -105.6 | 44 sn |
| 13 | negatif | …953530562493 | — | 7 | 0/0 (0) | — | — | 41 sn |
| 14 | negatif | …926543993263 | — | 17 | 0/0 (0) | — | — | 21 sn |
| 15 | negatif | …217770205256 | — | 10 | 0/0 (0) | — | — | 38 sn |
| 16 | negatif | …436462818860 | — | 2 | 0/0 (0) | — | — | 35 sn |
| 17 | negatif | …253331438797 | — | 7 | 0/0 (0) | — | — | 43 sn |

`⚠` işareti: GT'ye en yakın ≥0.05 aday çapın dışında kalmıştır (toleranslı ölçütte kaçak). Sütun, serideki en yakın ve — varsa — kaçan GT'nin uzaklığını birlikte gösterir.

## Kayıt doğrulaması

- `GT HU` sütunu, GT koordinatındaki 3×3×3 HU ortalamasıdır: nodül dokusu
  akciğer parankimi ortamında (~-800 HU) belirgin yüksek dansiteli olur (kireçlenmiş
  nodüller çok daha yüksek çıkabilir). Bu sütun koordinat kaydının (DICOM dünya ↔ GT)
  doğru olduğunu doğrular; ayrıca en yüksek skorlu kutunun GT'ye uzaklığı da ayrıca
  raporlanan mesafedir.

## Yorum ve sınırlar

- Model **LUNA16 kaynaklı** bir pakettir ve doğrulama da LUNA16/LIDC alt kümesi üzerinde
  yapılmıştır (aynı dağılım / in-domain). Bu, **dış (external) doğrulama değildir**;
  gerçek klinik performans genellikle daha düşüktür.
- Kohort bilinçli olarak küçük tutulmuştur (indirme bütçesi); güven aralıkları geniştir.
- GT, LUNA16 standart ≥3 mm nodülleri kapsar; daha küçük nodüller GT dışıdır.
- Üretim arayüzündeki derin tarama eşiği 0.30'dur; tablo 0.05–0.50 aralığını gösterir.
- Bulgular **aday** niteliğindedir; herhangi bir bulgunun klinik yorumu ve rapor onayı
  yalnızca radyoloji uzmanı tarafından yapılır.
- Yeniden üretim: `python ai-worker/validate_real.py --select 12 5` ardından
  `python ai-worker/validate_real.py`

## Kohort seri UID'leri

- `1.3.6.1.4.1.14519.5.2.1.6279.6001.970264865033574190975654369557` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.173556680294801532247454313511` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.114195693932194925962391697338` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.237215747217294006286437405216` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.217754016294471278921686508169` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.207341668080525761926965850679` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.171667800241622018839592854574` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.534083630500464995109143618896` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.163994693532965040247348251579` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.771741891125176943862272696845` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.313605260055394498989743099991` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.121108220866971173712229588402` — pozitif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.160216916075817913953530562493` — negatif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.240630002689062442926543993263` — negatif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.191301539558980174217770205256` — negatif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.269689294231892620436462818860` — negatif
- `1.3.6.1.4.1.14519.5.2.1.6279.6001.102133688497886810253331438797` — negatif
