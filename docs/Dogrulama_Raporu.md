# Derin AI Doğrulama Raporu (sentetik fantom)

- **Tarih:** 2026-10-29 02:56
- **Model:** C:\Users\cehen\.cache\atikviewer-ai\model\model.pt
- **Paket:** MONAI `lung_nodule_ct_detection` (LUNA16 eğitimi, Apache-2.0)
- **ROI:** (256, 256, 96) · **Cihaz:** cuda · **Çıkarım eşiği:** 0.05
- **Kapsam:** 4 pozitif + 2 negatif sentetik BT toraks vakası (tohum 42)
- **Yöntem:** Nodüllerin konumu/çapı/HU değeri bilinen fantomlarda çıkarım; tahmin
  kutusu (x,y,z) sırası GT merkezine çevrilerek merkez kutu içindeyse eşleşir (TP);
  GT kapsanmazsa FN, GT içermeyen tahmin FP, tahminsiz negatif tarama TN sayılır.

## Vaka detayları

| # | Vaka | Boyut (mm) | Gerçek | Tahmin skorları (≥0.05) | Eşleşen skor | Süre |
|---|------|------------|--------|--------------------------|--------------|------|
| 1 | nodül 4mm | 4 | var | 1.00, 0.70, 0.52, 0.36 (+2) | 1.00 | 14099 ms |
| 2 | nodül 6mm | 6 | var | 0.99, 0.82, 0.75, 0.44 (+4) | 0.99 | 7979 ms |
| 3 | nodül 8mm | 8 | var | 0.99, 0.47, 0.09, 0.07 (+2) | 0.99 | 8305 ms |
| 4 | nodül 12mm | 12 | var | 1.00, 0.92, 0.80, 0.13 (+3) | 1.00 | 7984 ms |
| 5 | negatif (nodülsüz) | — | yok (negatif) | 0.59, 0.55, 0.26, 0.18 (+4) | — | 8059 ms |
| 6 | negatif (nodülsüz) | — | yok (negatif) | 0.81, 0.32, 0.18, 0.06 | — | 8154 ms |

## Eşik taraması (aynı çıkarımdan)

| Skor eşiği | Duyarlılık | Özgüllük (tarama) | FP / tarama |
|------------|------------|--------------------|-------------|
| 0.05 | %100.0 (4/4) | %0.0 (0/2) | 5.8 |
| 0.10 | %100.0 (4/4) | %0.0 (0/2) | 3.7 |
| 0.20 | %100.0 (4/4) | %0.0 (0/2) | 2.7 |
| 0.30 | %100.0 (4/4) | %0.0 (0/2) | 2.2 |
| 0.50 | %100.0 (4/4) | %0.0 (0/2) | 1.5 |
| 0.70 | %100.0 (4/4) | %50.0 (1/2) | 0.8 |
| 0.85 | %100.0 (4/4) | %100.0 (2/2) | 0.2 |

## Yorum ve sınırlar

- Bu sayılar **sentetik fantom** kümesine aittir; modelin gerçek hasta verisindeki
  performansını **temsil etmez** ve klinik doğrulama yerine geçmez.
- Üretim arayüzündeki derin tarama eşiği 0.30'dur; tarama tablosu düşük eşiklerde
  duyarlılık/artan FP trade-off'unu gösterir.
- Klinik doğrulama: gerçek ground-truth'lu hasta seti (ör. LUNA16 kohortu,
  publicly-available ICH setleri) ile aynı tablo üretilmeli ve radyoloji uzmanı
  tarafından değerlendirilmelidir.
- Bulgular 'aday' niteliğindedir; rapor onayı her koşulda radyoloji uzmanına aittir.
- Yeniden üretim: `python ai-worker/validate.py`
