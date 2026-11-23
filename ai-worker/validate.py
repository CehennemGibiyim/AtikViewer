"""ATIKVIEWER derin AI doğrulama modu — duyarlılık/özgüllük tablosu üretir.

Bilinen ground-truth'a sahip SENTETİK BT toraks fantomları üretilir (nodüllerin
konumu/çapı/HU değeri belli), model bunlar üzerinde çalıştırılır ve tahminler
gerçek değerlerle eşleştirilerek duyarlılık/özgüllük tablosu çıkarılır.
Ücretsizdir; herhangi bir dış servis veya veri indirmesi gerekmez.

Kullanım:
    python ai-worker/validate.py                 # varsayılan: 4 pozitif + 2 negatif
    python ai-worker/validate.py --neg 4 --seed 7
    python ai-worker/validate.py --out docs/Dogrulama_Raporu.md

Tasarım notları:
- Model düşük eşikte (0.05) çalıştırılır, metrikler birden çok eşik için
  AYNI çıkarımdan hesaplanır (eşik taraması / FROC benzeri tablo).
- Kutu eşlemesi ve koordinat dönüşümü ai-worker/server.py ile BİREBİR aynıdır.
- Sentetik fantom klinik değerlendirmenin YERİNE GEÇMEZ; gerçek hasta verisi
  (ör. LUNA16 kohortu) ile aynı tablo klinik doğrulama için üretilmelidir.
"""

import argparse
import datetime
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # noqa: BLE001
        pass

import model_lib  # noqa: E402

# Fantom geometrisi (test_realistic.py ile aynı fizik varsayımlar)
W, H, D = 320, 320, 140
SPACING = (1.0, 1.0, 1.25)  # sz, sy, sx mm

# Nodül yerleri (voxeller) — akciğer parankim içi
SITES = [
    (int(D * 0.45), int(H * 0.35), int(W * 0.62)),
    (int(D * 0.55), int(H * 0.30), int(W * 0.38)),
]

# Değerlendirme eşikleri (çıkarım 0.05'te yapılır; metrikler tarama ile)
THRESHOLDS = [0.05, 0.10, 0.20, 0.30, 0.50, 0.70, 0.85]
DETECTOR_THRESH = 0.05  # çıkarım sırasında model seçici eşiği


def make_phantom(rng: np.random.Generator, nodule=None) -> np.ndarray:
    """BT toraks fantomu üretir. nodule=(zc, yc, xc, rad_mm, hu) veya None."""
    sz, sy, sx = SPACING
    hu = np.full((D, H, W), -1000.0, dtype=np.float32)
    zz, yy, xx = np.meshgrid(
        np.linspace(-1, 1, D), np.linspace(-1, 1, H), np.linspace(-1, 1, W), indexing="ij"
    )
    r2 = yy**2 + xx**2
    body = r2 < 0.90**2
    hu[body] = rng.normal(40, 30, size=int(body.sum())).astype(np.float32)

    lung_l = (((yy + 0.22) ** 2 / 0.30 + (xx + 0.40) ** 2 / 0.19) < 1.0)
    lung_r = (((yy + 0.22) ** 2 / 0.30 + (xx - 0.40) ** 2 / 0.19) < 1.0)
    lungs = lung_l | lung_r
    hu[lungs] = rng.normal(-850, 60, size=int(lungs.sum())).astype(np.float32)

    med = (np.abs(xx) < 0.16) & (yy > -0.15) & body
    hu[med] = rng.normal(45, 25, size=int(med.sum())).astype(np.float32)

    spine = ((yy - 0.62) ** 2 / 0.10 + xx**2 / 0.05) < 1.0
    hu[spine] = rng.normal(350, 80, size=int(spine.sum())).astype(np.float32)

    ang = np.arctan2(yy, xx)
    rr = np.sqrt(r2)
    ribs = (np.abs(rr - 0.86) < 0.035) & (np.sin(ang * 8) > 0.25) & body
    hu[ribs] = rng.normal(500, 120, size=int(ribs.sum())).astype(np.float32)

    for _ in range(40):
        z0 = rng.uniform(0.25, 0.75) * D
        y0 = rng.uniform(-0.55, -0.05) * H + H / 2
        x0 = rng.uniform(0.25, 0.55) * W if rng.random() < 0.5 else rng.uniform(0.45, 0.75) * W
        t = rng.normal(0, 1, 3) * np.array([D, H, W]) * 0.06
        L = int(np.linalg.norm(t)) + 1
        for s in range(L):
            f = s / L
            pz, py, px = int(z0 + t[0] * f), int(y0 + t[1] * f), int(x0 + t[2] * f)
            if 2 < pz < D - 2 and 2 < py < H - 2 and 2 < px < W - 2:
                hu[pz - 1 : pz + 2, py - 1 : py + 2, px - 1 : px + 2] = rng.normal(30, 15)

    if nodule is not None:
        zc, yc, xc, rad_mm, hu_val = nodule
        rz, ry, rx = rad_mm / sz, rad_mm / sy, rad_mm / sx
        z = np.arange(int(zc - 3 * rz), int(zc + 3 * rz) + 1)
        y = np.arange(int(yc - 3 * ry), int(yc + 3 * ry) + 1)
        x = np.arange(int(xc - 3 * rx), int(xc + 3 * rx) + 1)
        Z, Y, X = np.meshgrid(z, y, x, indexing="ij")
        noise = rng.normal(0, 0.25, size=Z.shape)
        dist = np.sqrt(((Z - zc) / rz) ** 2 + ((Y - yc) / ry) ** 2 + ((X - xc) / rx) ** 2) + noise
        m = dist < 1.0
        valid = (Z >= 0) & (Z < D) & (Y >= 0) & (Y < H) & (X >= 0) & (X < W)
        hu[Z[m & valid], Y[m & valid], X[m & valid]] = hu_val
    return hu


def boxes_to_orig(boxes, scores, orig_shape, res_shape):
    """Model uzayındaki xyzxyz kutularını orijinal (Z,Y,X) voxel uzayına çevir.

    server.py /infer dönüşümü ile BİREBİR aynıdır (döndürme + align_corners=False ölçeği).
    """
    z, y, x = orig_shape
    nx_r, ny_r, nz_r = res_shape
    out = []
    for b, s in zip(boxes, scores):
        x0, y0, z0, x1, y1, z1 = [float(v) for v in b]
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if z1 < z0:
            z0, z1 = z1, z0
        rx0 = (nx_r - 1) - x1
        rx1 = (nx_r - 1) - x0
        ry0 = (ny_r - 1) - y1
        ry1 = (ny_r - 1) - y0
        ox0 = (rx0 + 0.5) * (x / nx_r) - 0.5
        ox1 = (rx1 + 0.5) * (x / nx_r) - 0.5
        oy0 = (ry0 + 0.5) * (y / ny_r) - 0.5
        oy1 = (ry1 + 0.5) * (y / ny_r) - 0.5
        oz0 = (z0 + 0.5) * (z / nz_r) - 0.5
        oz1 = (z1 + 0.5) * (z / nz_r) - 0.5
        if (ox1 - ox0) / max(x - 1, 1) < 0.005 and (oy1 - oy0) / max(y - 1, 1) < 0.005:
            continue
        out.append(
            {
                "box": (
                    min(ox0, ox1), min(oy0, oy1), min(oz0, oz1),
                    max(ox0, ox1), max(oy0, oy1), max(oz0, oz1),
                ),
                "score": float(s),
            }
        )
    out.sort(key=lambda d: -d["score"])
    return out


def center_in_box(pt, box) -> bool:
    cx, cy, cz = pt
    x0, y0, z0, x1, y1, z1 = box
    return x0 <= cx <= x1 and y0 <= cy <= y1 and z0 <= cz <= z1


def gt_xyz(gt):
    """GT (z,y,x,...) → kutu sırasıyla (x,y,z) — eksen sırası UYUŞMAZLIĞI bu metodun baş belasıydı."""
    return (gt[2], gt[1], gt[0])


def run_case(hu: np.ndarray):
    """Bir vakayı modelden geçirir; TÜM tahminleri (>= DETECTOR_THRESH) döndürür."""
    t0 = time.time()
    resampled = model_lib.resample_to_luna16(hu, SPACING)
    boxes, scores = model_lib.run_inference(resampled)
    preds = boxes_to_orig(boxes, scores, hu.shape, resampled.shape)
    return {"preds": preds, "elapsedMs": int((time.time() - t0) * 1000)}


def evaluate(rows, thresh: float) -> dict:
    """Belirli eşikte duyarlılık/özgüllük/FP metriklerini hesaplar."""
    tp = fn = fp_total = 0
    neg_ok = neg_n = 0
    for r in rows:
        scored = [p for p in r["preds"] if p["score"] >= thresh]
        if r["gt"] is None:
            neg_n += 1
            if not scored:
                neg_ok += 1
            fp_total += len(scored)
        else:
            hit = any(center_in_box(gt_xyz(r["gt"]), p["box"]) for p in scored)
            tp += 1 if hit else 0
            fn += 0 if hit else 1
            matched = 1 if hit else 0
            fp_total += len(scored) - matched
    sens = tp / (tp + fn) if (tp + fn) else None
    spec = neg_ok / neg_n if neg_n else None
    return {
        "tp": tp, "fn": fn, "sens": sens, "spec": spec,
        "neg_ok": neg_ok, "neg_n": neg_n,
        "fp_scan": fp_total / len(rows) if rows else 0.0,
    }


def pct(v):
    return f"%{v * 100:.1f}" if v is not None else "—"


def md_detail_table(rows) -> str:
    lines = [
        "| # | Vaka | Boyut (mm) | Gerçek | Tahmin skorları (≥0.05) | Eşleşen skor | Süre |",
        "|---|------|------------|--------|--------------------------|--------------|------|",
    ]
    for i, r in enumerate(rows, 1):
        scores = [p["score"] for p in r["preds"]]
        score_str = ", ".join(f"{s:.2f}" for s in scores[:4]) + (f" (+{len(scores) - 4})" if len(scores) > 4 else "")
        if not scores:
            score_str = "—"
        if r["gt"] is None:
            size, gt_str, match = "—", "yok (negatif)", "—"
        else:
            hits = [p["score"] for p in r["preds"] if center_in_box(gt_xyz(r["gt"]), p["box"])]
            size = f"{r['gt'][3]:.0f}"
            gt_str = "var"
            match = f"{max(hits):.2f}" if hits else "yok ✗"
        lines.append(f"| {i} | {r['name']} | {size} | {gt_str} | {score_str} | {match} | {r['elapsedMs']} ms |")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Derin AI doğrulama: duyarlılık/özgüllük tablosu (eşik taramalı)")
    ap.add_argument("--pos", type=int, default=4, help="pozitif vaka sayısı (varsayılan 4)")
    ap.add_argument("--neg", type=int, default=2, help="negatif vaka sayısı (varsayılan 2)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "Dogrulama_Raporu.md"))
    ap.add_argument("--sizes", default="4,6,8,12", help="pozitif çaplar mm (döngüyle sarılır)")
    args = ap.parse_args()

    if not model_lib.model_ready():
        print(f"MODEL YOK: {model_lib.MODEL_PATH} — önce `python ai-worker/setup_model.py`", file=sys.stderr)
        return 2

    # Model ilk çağrıda kurulur; seçici eşiğini düşük tut ki tarama mümkün olsun
    model_lib.SCORE_THRESH = DETECTOR_THRESH

    sizes = [float(v) for v in args.sizes.split(",") if v.strip()]
    cases = []
    for i in range(args.pos):
        size = sizes[i % len(sizes)]
        site = SITES[i % len(SITES)]
        hu_val = 25.0 if i % 2 == 0 else 45.0
        cases.append(("pozitif", site, size, hu_val))
    for i in range(args.neg):
        cases.append(("negatif", None, 0.0, 0.0))

    print(
        f"Doğrulama başlıyor: {len(cases)} vaka · model={model_lib.MODEL_PATH} · "
        f"çıkarım eşiği={DETECTOR_THRESH} · metrik eşikleri={THRESHOLDS}",
        flush=True,
    )
    rows = []
    for i, (kind, site, size, hu_val) in enumerate(cases):
        rng = np.random.default_rng(args.seed + i)
        gt = (site[0], site[1], site[2], size, hu_val) if kind == "pozitif" else None
        hu = make_phantom(rng, nodule=gt)
        res = run_case(hu)
        name = f"nodül {size:.0f}mm" if kind == "pozitif" else "negatif (nodülsüz)"
        rows.append({"name": name, "gt": gt, **res})
        print(f"  [{i + 1}/{len(cases)}] {name}: {len(res['preds'])} tahmin · {res['elapsedMs']} ms", flush=True)

    sweeps = {t: evaluate(rows, t) for t in THRESHOLDS}
    for t, m in sweeps.items():
        print(
            f"  eşik {t:.2f} → duyarlılık {pct(m['sens'])} ({m['tp']}/{m['tp'] + m['fn']}) · "
            f"özgüllük {pct(m['spec'])} ({m['neg_ok']}/{m['neg_n']}) · FP/tarama {m['fp_scan']:.1f}",
            flush=True,
        )

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    sweep_lines = [
        "| Skor eşiği | Duyarlılık | Özgüllük (tarama) | FP / tarama |",
        "|------------|------------|--------------------|-------------|",
    ]
    for t in THRESHOLDS:
        m = sweeps[t]
        sweep_lines.append(
            f"| {t:.2f} | {pct(m['sens'])} ({m['tp']}/{m['tp'] + m['fn']}) | "
            f"{pct(m['spec'])} ({m['neg_ok']}/{m['neg_n']}) | {m['fp_scan']:.1f} |"
        )

    md = "\n".join(
        [
            "# Derin AI Doğrulama Raporu (sentetik fantom)",
            "",
            f"- **Tarih:** {now}",
            f"- **Model:** {model_lib.MODEL_PATH}",
            "- **Paket:** MONAI `lung_nodule_ct_detection` (LUNA16 eğitimi, Apache-2.0)",
            f"- **ROI:** {model_lib.ROI_SIZE} · **Cihaz:** {model_lib.DEVICE} · **Çıkarım eşiği:** {DETECTOR_THRESH}",
            f"- **Kapsam:** {args.pos} pozitif + {args.neg} negatif sentetik BT toraks vakası (tohum {args.seed})",
            "- **Yöntem:** Nodüllerin konumu/çapı/HU değeri bilinen fantomlarda çıkarım; tahmin",
            "  kutusu (x,y,z) sırası GT merkezine çevrilerek merkez kutu içindeyse eşleşir (TP);",
            "  GT kapsanmazsa FN, GT içermeyen tahmin FP, tahminsiz negatif tarama TN sayılır.",
            "",
            "## Vaka detayları",
            "",
            md_detail_table(rows),
            "",
            "## Eşik taraması (aynı çıkarımdan)",
            "",
            "\n".join(sweep_lines),
            "",
            "## Yorum ve sınırlar",
            "",
            "- Bu sayılar **sentetik fantom** kümesine aittir; modelin gerçek hasta verisindeki",
            "  performansını **temsil etmez** ve klinik doğrulama yerine geçmez.",
            "- Üretim arayüzündeki derin tarama eşiği 0.30'dur; tarama tablosu düşük eşiklerde",
            "  duyarlılık/artan FP trade-off'unu gösterir.",
            "- Klinik doğrulama: gerçek ground-truth'lu hasta seti (ör. LUNA16 kohortu,",
            "  publicly-available ICH setleri) ile aynı tablo üretilmeli ve radyoloji uzmanı",
            "  tarafından değerlendirilmelidir.",
            "- Bulgular 'aday' niteliğindedir; rapor onayı her koşulda radyoloji uzmanına aittir.",
            "- Yeniden üretim: `python ai-worker/validate.py`",
            "",
        ]
    )
    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(md)
    print(f"Rapor yazıldı: {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
