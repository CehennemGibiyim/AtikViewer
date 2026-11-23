# Klinik Doğrulama Raporu — İCH / SAH (gerçek uzman maskesi)

- **Tarih:** 2026-10-29 15:49
- **Model:** ianpan/ct-head-hemorrhage-detection (MIT, RSNA ICH eğitimi)
- **Cihaz:** cuda · **Üretim eşiği:** 0.3 · **Vaka sayısı:** 100
- **Veri:** Zenodo *Subarachnoid Hemorrhage RHUH* (100 kafa BT, uzman SAH maskeleri,
  CC BY 4.0, [zenodo.org/records/8228847](https://zenodo.org/records/8228847))
- **Yöntem:** NIfTI CT → (Z,Y,X) → üretimle aynı brain_lib çıkarımı.
  GT pozitif kesit = maske vokseli olan kesit; model pozitif kesit = herhangi bir
  kanama tipi olasılığı ≥ eşik. Kutu ölçütü: kutu kesit aralığı GT kesitleriyle
  kesişmeli; konumlandırma = GT 2D bbox merkezi tahmin kutusunda.

## Sonuç (özet, üretim eşiği 0.30)

- **Vaka duyarlılığı:** %43.0 (43/100) —
  model en az bir GT kesitle kesişen kutu üretti.
- **Konumlandırma doğru:** 37/43 yakalanan vakada GT 2D bbox merkezi
  tahmin kutusunun içinde.
- **Kutu bazında:** 68 kutu · 0 GT dışı (FP) · FP/vaka 0.0
- **Kesit düzeyi (0.30):** duyarlılık %7.6 (556/7284) · FP kesit/vaka 0.0 (toplam 19300 kesit değerlendirildi)

## Kesit düzeyi eşik taraması

| Eşik | Vaka duyarlılığı (en az 1 GT kesiti) | Kesit duyarlılığı | FP kesit / vaka |
|------|--------------------------------------|-------------------|-----------------|
| 0.10 | %69.0 (69/100) | %22.0 (1604/7284) | 0.1 |
| 0.20 | %56.0 (56/100) | %12.6 (916/7284) | 0.0 |
| 0.30 | %43.0 (43/100) | %7.6 (556/7284) | 0.0 |
| 0.50 | %22.0 (22/100) | %2.5 (181/7284) | 0.0 |

## Bulguların yorumu

- Üretim eşiği 0.30'da bu dış kohortta vaka duyarlılığı %43.0 (43/100); 57 vaka hiç yakalanmadı. Kutu düzeyinde 0 FP var, fakat kohortta negatif vaka bulunmadığından özgüllük hesaplanamaz.
- Eşik 0.10'a düşürülünce kesit duyarlılığı %22.0'e çıkıyor (FP kesit/vaka 0.1'de kalıyor). Üretim eşiği bu dış veride duyarlılık açısından muhafazakârdır.
- Sonuç: bu tablo modelin tek başına tanısal kullanım için uygun olmadığını gösterir; üretimde yalnızca radyoloji uzmanı onaylı **aday** işaretleme olarak kalmalıdır.

## Vaka detayları

| # | Vaka | Kesit | GT kesit | Kutu (hit/FP) | Vaka yakalandı | Konum ✓ | Seri 'any' | Süre |
|---|------|-------|----------|---------------|----------------|---------|------------|------|
| 1 | huh_001 | 193 | 89 | 1/0 | ✓ | ✗ | 0.34 | 649 sn |
| 2 | huh_002 | 193 | 52 | 0/0 | ✗ | — | 0.04 | 84 sn |
| 3 | huh_003 | 193 | 72 | 1/0 | ✓ | ✓ | 0.37 | 13 sn |
| 4 | huh_004 | 193 | 121 | 2/0 | ✓ | ✓ | 0.79 | 12 sn |
| 5 | huh_005 | 193 | 129 | 1/0 | ✓ | ✓ | 0.31 | 11 sn |
| 6 | huh_006 | 193 | 105 | 0/0 | ✗ | — | 0.08 | 12 sn |
| 7 | huh_007 | 193 | 33 | 0/0 | ✗ | — | 0.03 | 12 sn |
| 8 | huh_008 | 193 | 112 | 1/0 | ✓ | ✓ | 0.38 | 13 sn |
| 9 | huh_009 | 193 | 82 | 0/0 | ✗ | — | 0.29 | 14 sn |
| 10 | huh_010 | 193 | 67 | 0/0 | ✗ | — | 0.09 | 11 sn |
| 11 | huh_011 | 193 | 148 | 1/0 | ✓ | ✓ | 0.53 | 11 sn |
| 12 | huh_012 | 193 | 98 | 0/0 | ✗ | — | 0.14 | 65 sn |
| 13 | huh_013 | 193 | 86 | 0/0 | ✗ | — | 0.13 | 9 sn |
| 14 | huh_014 | 193 | 72 | 0/0 | ✗ | — | 0.25 | 7 sn |
| 15 | huh_015 | 193 | 37 | 0/0 | ✗ | — | 0.38 | 12 sn |
| 16 | huh_016 | 193 | 25 | 0/0 | ✗ | — | 0.15 | 13 sn |
| 17 | huh_017 | 193 | 47 | 0/0 | ✗ | — | 0.09 | 13 sn |
| 18 | huh_018 | 193 | 83 | 1/0 | ✓ | ✗ | 0.31 | 15 sn |
| 19 | huh_019 | 193 | 35 | 0/0 | ✗ | — | 0.07 | 14 sn |
| 20 | huh_020 | 193 | 55 | 1/0 | ✓ | ✓ | 0.49 | 12 sn |
| 21 | huh_021 | 193 | 66 | 1/0 | ✓ | ✗ | 0.34 | 15 sn |
| 22 | huh_022 | 193 | 91 | 0/0 | ✗ | — | 0.15 | 12 sn |
| 23 | huh_023 | 193 | 70 | 0/0 | ✗ | — | 0.03 | 13 sn |
| 24 | huh_024 | 193 | 46 | 2/0 | ✓ | ✓ | 0.64 | 16 sn |
| 25 | huh_025 | 193 | 48 | 0/0 | ✗ | — | 0.02 | 20 sn |
| 26 | huh_026 | 193 | 65 | 2/0 | ✓ | ✓ | 0.63 | 24 sn |
| 27 | huh_027 | 193 | 62 | 0/0 | ✗ | — | 0.07 | 18 sn |
| 28 | huh_028 | 193 | 59 | 0/0 | ✗ | — | 0.06 | 13 sn |
| 29 | huh_029 | 193 | 64 | 1/0 | ✓ | ✗ | 0.44 | 13 sn |
| 30 | huh_030 | 193 | 4 | 0/0 | ✗ | — | 0.02 | 12 sn |
| 31 | huh_031 | 193 | 55 | 0/0 | ✗ | — | 0.06 | 13 sn |
| 32 | huh_032 | 193 | 71 | 0/0 | ✗ | — | 0.17 | 12 sn |
| 33 | huh_033 | 193 | 20 | 0/0 | ✗ | — | 0.02 | 13 sn |
| 34 | huh_034 | 193 | 64 | 0/0 | ✗ | — | 0.15 | 12 sn |
| 35 | huh_035 | 193 | 100 | 0/0 | ✗ | — | 0.35 | 15 sn |
| 36 | huh_036 | 193 | 61 | 2/0 | ✓ | ✓ | 0.48 | 11 sn |
| 37 | huh_037 | 193 | 104 | 0/0 | ✗ | — | 0.22 | 13 sn |
| 38 | huh_038 | 193 | 44 | 0/0 | ✗ | — | 0.02 | 12 sn |
| 39 | huh_039 | 193 | 40 | 0/0 | ✗ | — | 0.03 | 13 sn |
| 40 | huh_040 | 193 | 53 | 1/0 | ✓ | ✓ | 0.98 | 12 sn |
| 41 | huh_041 | 193 | 15 | 0/0 | ✗ | — | 0.02 | 12 sn |
| 42 | huh_042 | 193 | 78 | 2/0 | ✓ | ✓ | 0.40 | 12 sn |
| 43 | huh_043 | 193 | 45 | 1/0 | ✓ | ✓ | 0.24 | 16 sn |
| 44 | huh_044 | 193 | 51 | 0/0 | ✗ | — | 0.04 | 13 sn |
| 45 | huh_045 | 193 | 15 | 0/0 | ✗ | — | 0.02 | 12 sn |
| 46 | huh_046 | 193 | 17 | 0/0 | ✗ | — | 0.09 | 12 sn |
| 47 | huh_047 | 193 | 96 | 1/0 | ✓ | ✗ | 0.23 | 14 sn |
| 48 | huh_048 | 193 | 62 | 2/0 | ✓ | ✓ | 0.71 | 15 sn |
| 49 | huh_049 | 193 | 55 | 0/0 | ✗ | — | 0.29 | 13 sn |
| 50 | huh_050 | 193 | 65 | 3/0 | ✓ | ✓ | 0.49 | 15 sn |
| 51 | huh_051 | 193 | 123 | 2/0 | ✓ | ✓ | 0.59 | 12 sn |
| 52 | huh_052 | 193 | 47 | 0/0 | ✗ | — | 0.07 | 15 sn |
| 53 | huh_053 | 193 | 159 | 1/0 | ✓ | ✓ | 0.38 | 12 sn |
| 54 | huh_054 | 193 | 114 | 3/0 | ✓ | ✓ | 0.39 | 10 sn |
| 55 | huh_055 | 193 | 114 | 1/0 | ✓ | ✓ | 0.66 | 14 sn |
| 56 | huh_056 | 193 | 117 | 0/0 | ✗ | — | 0.28 | 12 sn |
| 57 | huh_057 | 193 | 111 | 0/0 | ✗ | — | 0.09 | 13 sn |
| 58 | huh_058 | 193 | 121 | 4/0 | ✓ | ✓ | 0.87 | 13 sn |
| 59 | huh_059 | 193 | 79 | 0/0 | ✗ | — | 0.04 | 7 sn |
| 60 | huh_060 | 193 | 58 | 0/0 | ✗ | — | 0.22 | 14 sn |
| 61 | huh_061 | 193 | 45 | 0/0 | ✗ | — | 0.04 | 14 sn |
| 62 | huh_062 | 193 | 43 | 1/0 | ✓ | ✗ | 0.23 | 15 sn |
| 63 | huh_063 | 193 | 63 | 1/0 | ✓ | ✓ | 0.45 | 15 sn |
| 64 | huh_064 | 193 | 60 | 1/0 | ✓ | ✓ | 0.28 | 13 sn |
| 65 | huh_065 | 193 | 92 | 1/0 | ✓ | ✓ | 0.24 | 14 sn |
| 66 | huh_066 | 193 | 9 | 0/0 | ✗ | — | 0.03 | 15 sn |
| 67 | huh_067 | 193 | 133 | 1/0 | ✓ | ✓ | 0.24 | 15 sn |
| 68 | huh_068 | 193 | 119 | 1/0 | ✓ | ✓ | 0.47 | 15 sn |
| 69 | huh_069 | 193 | 22 | 0/0 | ✗ | — | 0.02 | 14 sn |
| 70 | huh_070 | 193 | 111 | 3/0 | ✓ | ✓ | 0.88 | 12 sn |
| 71 | huh_071 | 193 | 85 | 2/0 | ✓ | ✓ | 0.45 | 14 sn |
| 72 | huh_072 | 193 | 129 | 1/0 | ✓ | ✓ | 0.20 | 13 sn |
| 73 | huh_073 | 193 | 114 | 1/0 | ✓ | ✓ | 0.29 | 10 sn |
| 74 | huh_074 | 193 | 114 | 0/0 | ✗ | — | 0.02 | 14 sn |
| 75 | huh_075 | 193 | 27 | 0/0 | ✗ | — | 0.24 | 12 sn |
| 76 | huh_076 | 193 | 119 | 0/0 | ✗ | — | 0.18 | 14 sn |
| 77 | huh_077 | 193 | 20 | 0/0 | ✗ | — | 0.02 | 13 sn |
| 78 | huh_078 | 193 | 85 | 0/0 | ✗ | — | 0.07 | 13 sn |
| 79 | huh_079 | 193 | 67 | 0/0 | ✗ | — | 0.08 | 13 sn |
| 80 | huh_080 | 193 | 19 | 0/0 | ✗ | — | 0.04 | 12 sn |
| 81 | huh_081 | 193 | 43 | 0/0 | ✗ | — | 0.32 | 15 sn |
| 82 | huh_082 | 193 | 124 | 0/0 | ✗ | — | 0.24 | 13 sn |
| 83 | huh_083 | 193 | 73 | 0/0 | ✗ | — | 0.19 | 13 sn |
| 84 | huh_084 | 193 | 110 | 3/0 | ✓ | ✓ | 0.49 | 9 sn |
| 85 | huh_085 | 193 | 27 | 0/0 | ✗ | — | 0.07 | 10 sn |
| 86 | huh_086 | 193 | 20 | 0/0 | ✗ | — | 0.07 | 16 sn |
| 87 | huh_087 | 193 | 66 | 0/0 | ✗ | — | 0.13 | 11 sn |
| 88 | huh_088 | 193 | 86 | 0/0 | ✗ | — | 0.11 | 11 sn |
| 89 | huh_089 | 193 | 28 | 0/0 | ✗ | — | 0.02 | 12 sn |
| 90 | huh_090 | 193 | 104 | 2/0 | ✓ | ✓ | 0.28 | 14 sn |
| 91 | huh_091 | 193 | 102 | 0/0 | ✗ | — | 0.11 | 15 sn |
| 92 | huh_092 | 193 | 56 | 2/0 | ✓ | ✓ | 0.88 | 15 sn |
| 93 | huh_093 | 193 | 115 | 1/0 | ✓ | ✓ | 0.33 | 14 sn |
| 94 | huh_094 | 193 | 53 | 1/0 | ✓ | ✓ | 0.71 | 13 sn |
| 95 | huh_095 | 193 | 120 | 2/0 | ✓ | ✓ | 0.29 | 13 sn |
| 96 | huh_096 | 193 | 57 | 0/0 | ✗ | — | 0.18 | 13 sn |
| 97 | huh_097 | 193 | 29 | 0/0 | ✗ | — | 0.10 | 14 sn |
| 98 | huh_098 | 193 | 106 | 3/0 | ✓ | ✓ | 0.40 | 13 sn |
| 99 | huh_099 | 193 | 107 | 2/0 | ✓ | ✓ | 0.27 | 15 sn |
| 100 | huh_100 | 193 | 105 | 1/0 | ✓ | ✓ | 0.71 | 12 sn |

## Yorum ve sınırlar

- **Kohort 100 vakadır ve tek merkezden gelir.** Vaka duyarlılığı %43.0 (95% Wilson GA %33.7–%52.8); sonuç yalnızca bu aralıkta ve yukarıdaki ölçütlerle yorumlanmalıdır.
- **Bu kohort SAH özeldir ve negatif (kanamasız) vaka içermez** — özgüllük / FP oranı
  yalnızca kesit düzeyinde hesaplanabilir; vaka düzeyinde özgüllük için kanamasız
  kohort gerekir (ör. RSNA/CQ500 negatifleri — bu veriler giriş/kayıt duvarı arkasındadır).
- Veri tek merkezden (RHUH) ve tek patolojiden (SAH) gelir; diğer kanama tipleri bu
  tabloda değerlendirilemez.
- Veri 1 mm NIfTI olarak, RSNA eğitim verisinin 16-bit PNG formatından farklı bir
  zincirden gelir (dış doğrulama niteliği taşır); model bu veride ayrıca incelenmelidir.
- Bulgular **aday** niteliğindedir; klinik yorum ve rapor onayı yalnızca radyoloji
  uzmanı tarafından yapılır.
- Yeniden üretim: `python ai-worker/validate_ich.py` (veri: ai-worker/data/sah)

Model çıktısı: ianpan/ct-head-hemorrhage-detection (MIT, RSNA ICH, yerel çıkarım)
