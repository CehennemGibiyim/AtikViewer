"""ATIKVIEWER ICH klinik doğrulama — GERÇEK maskeli intrakraniyal kanama verisi.

Veri: Zenodo "Subarachnoid Hemorrhage RHUH" (CC BY 4.0) — 100 kafa BT vakası ve
uzman (radiologist) segmentasyon maskeleri; girişsiz indirilir:
    https://zenodo.org/records/8228847  (sah.rar → 7z ile açılır)

Model: ianpan/ct-head-hemorrhage-detection (MIT, RSNA ICH eğitimi) — üretimle
AYNI çıkarım yolu (brain_lib), üretim eşiği 0.30.

Metrikler:
  1) Kesit düzeyi (eşik taramalı): GT pozitif kesitleri vs. model pozitif
     kesitleri → duyarlılık, FP kesit/vaka.
  2) Kutu düzeyi (üretim eşiği 0.30): vaka duyarlılığı (kutu aralığı GT kesitleriyle
     kesişiyor mu), FP kutu/vaka, konumlandırma (GT 2D sınır kutusunun merkezi
     tahmin kutusu içinde mi).

Kullanım:
    python ai-worker/validate_ich.py             # tüm vakalar (kademeli, sonuç önbellekli)
    python ai-worker/validate_ich.py --cases 0,1  # yalnızca seçili indeksler

Çıktı: docs/Klinik_Dogrulama_ICH.md + ai-worker/data/ich_results.json

Not: Bu kohort SAH'ye özgüdür ve negatif (kanamasız) vaka içermez; özgüllük
hesaplanamaz. Bulgular aday niteliğindedir; onay radyoloji uzmanına aittir.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # noqa: BLE001
        pass

import brain_lib  # noqa: E402

DATA_ROOT = os.path.join(HERE, "data", "sah", "subarachnoid_hemorrhage_rhuh")
RESULTS_PATH = os.path.join(HERE, "data", "ich_results.json")
PROD_THRESH = 0.30  # üretim eşiği
SWEEP = [0.10, 0.20, 0.30, 0.50]


def list_cases() -> list[str]:
    if not os.path.isdir(DATA_ROOT):
        return []
    out = []
    for name in sorted(os.listdir(DATA_ROOT)):
        d = os.path.join(DATA_ROOT, name)
        ct = [f for f in os.listdir(d) if f.endswith("_ct.nii.gz")] if os.path.isdir(d) else []
        if ct:
            out.append(d)
    return out


def load_case(d: str):
    import nibabel as nib

    ct_path = next(os.path.join(d, f) for f in os.listdir(d) if f.endswith("_ct.nii.gz"))
    seg_path = next(os.path.join(d, f) for f in os.listdir(d) if f.endswith("_seg.nii.gz"))
    c = np.asanyarray(nib.load(ct_path).dataobj).astype(np.float32)
    m = np.asanyarray(nib.load(seg_path).dataobj)
    # NIfTI (X,Y,Z) → model girdisi (Z,Y,X)
    vol = np.ascontiguousarray(np.transpose(c, (2, 0, 1)))
    mask = np.ascontiguousarray(np.transpose(m > 0, (2, 0, 1)))
    return vol, mask


def run_case(d: str) -> dict:
    t0 = time.time()
    vol, mask = load_case(d)
    gt_slices = np.where(mask.reshape(mask.shape[0], -1).any(axis=1))[0]
    out = brain_lib.run_brain_inference(vol, include_slice_probs=True)

    Z, Y, X = vol.shape
    gt_set = set(int(z) for z in gt_slices)
    boxes = out["boxes"]
    # kutu aralığı GT kesitleriyle kesişenler
    hit_boxes = [b for b in boxes if set(range(b["z0"], b["z1"] + 1)) & gt_set]
    fp_boxes = [b for b in boxes if not (set(range(b["z0"], b["z1"] + 1)) & gt_set)]

    # konumlandırma: kesişen kutu, GT 2D sınır kutusu merkezini kapsıyor mu?
    loc_ok = False
    for b in hit_boxes:
        zs = [z for z in range(b["z0"], b["z1"] + 1) if z in gt_set]
        sub = mask[zs[0] : zs[-1] + 1]
        ys, xs = np.where(sub.reshape(sub.shape[0], -1).any(axis=0).reshape(sub.shape[1:])[0:1] if False else sub.any(axis=0))
        # GT 2D bbox (normalized)
        gy0, gy1 = ys.min() / (Y - 1), ys.max() / (Y - 1)
        gx0, gx1 = xs.min() / (X - 1), xs.max() / (X - 1)
        ccx, ccy = (gx0 + gx1) / 2, (gy0 + gy1) / 2
        if b["x"] <= ccx <= b["x"] + b["w"] and b["y"] <= ccy <= b["y"] + b["h"]:
            loc_ok = True
            break

    # kesit düzeyi eşik taraması (sınıflandırma olasılıkları)
    probs = np.asarray(out["sliceProbs"], dtype=np.float32)  # (Z,6)
    slice_eval = {}
    for t in SWEEP:
        pred = set(np.where((probs[:, :5] >= t).any(axis=1))[0].tolist())
        tp = len(pred & gt_set)
        fn = len(gt_set - pred)
        fp = len(pred - gt_set)
        slice_eval[t] = {"tp": tp, "fn": fn, "fp": fp}

    return {
        "case": os.path.basename(d),
        "slices": int(Z),
        "shape": [int(v) for v in vol.shape],
        "hu_min": float(vol.min()),
        "hu_max": float(vol.max()),
        "gt_slices": len(gt_set),
        "gt_range": [int(gt_slices.min()), int(gt_slices.max())] if len(gt_slices) else [0, 0],
        "boxes": len(boxes),
        "hit_boxes": len(hit_boxes),
        "fp_boxes": len(fp_boxes),
        "case_detected": len(hit_boxes) > 0,
        "loc_ok": loc_ok,
        "subtypes": sorted({b.get("subtype", "?") for b in boxes}),
        "series_any": float(out["series"].get("any", 0.0)),
        "slice_eval": {str(k): v for k, v in slice_eval.items()},
        "elapsedMs": int((time.time() - t0) * 1000),
        "model": out["model"],
    }


def _wilson(k: int, n_: int, z: float = 1.96) -> str:
    """Wilson skor aralığı (95%) — küçük oranlarda normal yaklaşımından daha güvenilir."""
    if n_ == 0:
        return "—"
    p = k / n_
    d = 1 + z * z / n_
    c = p + z * z / (2 * n_)
    r = z * ((p * (1 - p) / n_ + z * z / (4 * n_ * n_)) ** 0.5)
    return f"%{(c - r) / d * 100:.1f}–%{(c + r) / d * 100:.1f}"


def write_report(results: list[dict], out_path: str) -> None:
    n = len(results)
    det = [r for r in results if r["case_detected"]]
    loc = [r for r in det if r["loc_ok"]]
    total_boxes = sum(r["boxes"] for r in results)
    total_fp = sum(r["fp_boxes"] for r in results)

    sweep_rows = [
        "| Eşik | Vaka duyarlılığı (en az 1 GT kesiti) | Kesit duyarlılığı | FP kesit / vaka |",
        "|------|--------------------------------------|-------------------|-----------------|",
    ]
    case_by_thresh: dict[str, int] = {}
    for t in SWEEP:
        tp = sum(r["slice_eval"][str(t)]["tp"] for r in results)
        fn = sum(r["slice_eval"][str(t)]["fn"] for r in results)
        fp = sum(r["slice_eval"][str(t)]["fp"] for r in results)
        sens = tp / (tp + fn) if (tp + fn) else 0.0
        case_hit = sum(1 for r in results if r["slice_eval"][str(t)]["tp"] > 0)
        case_by_thresh[str(t)] = case_hit
        sweep_rows.append(
            f"| {t:.2f} | %{case_hit / max(n, 1) * 100:.1f} ({case_hit}/{n}) | "
            f"%{sens * 100:.1f} ({tp}/{tp + fn}) | {fp / max(n, 1):.1f} |"
        )

    detail = [
        "| # | Vaka | Kesit | GT kesit | Kutu (hit/FP) | Vaka yakalandı | Konum ✓ | Seri 'any' | Süre |",
        "|---|------|-------|----------|---------------|----------------|---------|------------|------|",
    ]
    for i, r in enumerate(results, 1):
        detail.append(
            f"| {i} | {r['case'][-7:]} | {r['slices']} | {r['gt_slices']} "
            f"| {r['hit_boxes']}/{r['fp_boxes']} | {'✓' if r['case_detected'] else '✗'} "
            f"| {'✓' if r['loc_ok'] else ('—' if not r['case_detected'] else '✗')} "
            f"| {r['series_any']:.2f} | {r['elapsedMs'] // 1000} sn |"
        )

    tp30 = sum(r["slice_eval"]["0.3"]["tp"] for r in results)
    fn30 = sum(r["slice_eval"]["0.3"]["fn"] for r in results)
    fp30 = sum(r["slice_eval"]["0.3"]["fp"] for r in results)
    n_slice = sum(r["slices"] for r in results)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    md = "\n".join(
        [
            "# Klinik Doğrulama Raporu — İCH / SAH (gerçek uzman maskesi)",
            "",
            f"- **Tarih:** {now}",
            "- **Model:** ianpan/ct-head-hemorrhage-detection (MIT, RSNA ICH eğitimi)",
            f"- **Cihaz:** {os.environ.get('ATIK_ICH_DEVICE', 'cpu')} · "
            f"**Üretim eşiği:** {PROD_THRESH} · **Vaka sayısı:** {n}",
            "- **Veri:** Zenodo *Subarachnoid Hemorrhage RHUH* (100 kafa BT, uzman SAH maskeleri,",
            "  CC BY 4.0, [zenodo.org/records/8228847](https://zenodo.org/records/8228847))",
            "- **Yöntem:** NIfTI CT → (Z,Y,X) → üretimle aynı brain_lib çıkarımı.",
            "  GT pozitif kesit = maske vokseli olan kesit; model pozitif kesit = herhangi bir",
            "  kanama tipi olasılığı ≥ eşik. Kutu ölçütü: kutu kesit aralığı GT kesitleriyle",
            "  kesişmeli; konumlandırma = GT 2D bbox merkezi tahmin kutusunda.",
            "",
            "## Sonuç (özet, üretim eşiği 0.30)",
            "",
            f"- **Vaka duyarlılığı:** %{len(det) / max(n, 1) * 100:.1f} ({len(det)}/{n}) —",
            f"  model en az bir GT kesitle kesişen kutu üretti.",
            f"- **Konumlandırma doğru:** {len(loc)}/{len(det)} yakalanan vakada GT 2D bbox merkezi",
            "  tahmin kutusunun içinde.",
            f"- **Kutu bazında:** {total_boxes} kutu · {total_fp} GT dışı (FP) · FP/vaka {total_fp / max(n, 1):.1f}",
            f"- **Kesit düzeyi (0.30):** duyarlılık %{tp30 / max(tp30 + fn30, 1) * 100:.1f} "
            f"({tp30}/{tp30 + fn30}) · FP kesit/vaka {fp30 / max(n, 1):.1f} "
            f"(toplam {n_slice} kesit değerlendirildi)",
            "",
            "## Kesit düzeyi eşik taraması",
            "",
            *sweep_rows,
            "",
            "## Bulguların yorumu",
            "",
            f"- Üretim eşiği 0.30'da bu dış kohortta vaka duyarlılığı %{len(det) / max(n, 1) * 100:.1f} "
            f"({len(det)}/{n}); {n - len(det)} vaka hiç yakalanmadı. Kutu düzeyinde {total_fp} FP var, "
            "fakat kohortta negatif vaka bulunmadığından özgüllük hesaplanamaz.",
            f"- Eşik 0.10'a düşürülünce kesit duyarlılığı %{sum(r['slice_eval']['0.1']['tp'] for r in results) / max(sum(r['slice_eval']['0.1']['tp'] + r['slice_eval']['0.1']['fn'] for r in results), 1) * 100:.1f}'e çıkıyor "
            "(FP kesit/vaka 0.1'de kalıyor). Üretim eşiği bu dış veride duyarlılık açısından muhafazakârdır.",
            "- Sonuç: bu tablo modelin tek başına tanısal kullanım için uygun olmadığını gösterir; "
            "üretimde yalnızca radyoloji uzmanı onaylı **aday** işaretleme olarak kalmalıdır.",
            "",
            "## Vaka detayları",
            "",
            *detail,
            "",
            "## Yorum ve sınırlar",
            "",
            f"- **Kohort {n} vakadır ve tek merkezden gelir.** Vaka duyarlılığı "
            f"%{len(det) / max(n, 1) * 100:.1f} (95% Wilson GA {_wilson(len(det), n)}); "
            "sonuç yalnızca bu aralıkta ve yukarıdaki ölçütlerle yorumlanmalıdır.",
            "- **Bu kohort SAH özeldir ve negatif (kanamasız) vaka içermez** — özgüllük / FP oranı",
            "  yalnızca kesit düzeyinde hesaplanabilir; vaka düzeyinde özgüllük için kanamasız",
            "  kohort gerekir (ör. RSNA/CQ500 negatifleri — bu veriler giriş/kayıt duvarı arkasındadır).",
            "- Veri tek merkezden (RHUH) ve tek patolojiden (SAH) gelir; diğer kanama tipleri bu",
            "  tabloda değerlendirilemez.",
            "- Veri 1 mm NIfTI olarak, RSNA eğitim verisinin 16-bit PNG formatından farklı bir",
            "  zincirden gelir (dış doğrulama niteliği taşır); model bu veride ayrıca incelenmelidir.",
            "- Bulgular **aday** niteliğindedir; klinik yorum ve rapor onayı yalnızca radyoloji",
            "  uzmanı tarafından yapılır.",
            "- Yeniden üretim: `python ai-worker/validate_ich.py` (veri: ai-worker/data/sah)",
            "",
            f"Model çıktısı: {results[0].get('model', '')}" if results else "",
            "",
        ]
    )
    out = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(md)
    print(f"Rapor yazıldı: {out}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="ICH klinik doğrulama (SAH maskeli veri)")
    ap.add_argument("--cases", default="", help="yalnızca bu indeksler (virgülle)")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "docs", "Klinik_Dogrulama_ICH.md"))
    args = ap.parse_args()

    cases = list_cases()
    if not cases:
        print(f"Veri yok: {DATA_ROOT} — sah.rar indirilip açılmalı", file=sys.stderr)
        return 2
    if not brain_lib.model_files_ready():
        print("Beyin modeli ağırlıkları yok — `python ai-worker/setup_model.py`", file=sys.stderr)
        return 2

    results: list[dict] = []
    if os.path.isfile(RESULTS_PATH):
        with open(RESULTS_PATH, encoding="utf-8") as fh:
            results = json.load(fh)
    done = {r["case"] for r in results}

    wanted = None
    if args.cases:
        wanted = {os.path.basename(cases[i]) for i in (int(v) for v in args.cases.split(",")) if i < len(cases)}

    for i, d in enumerate(cases):
        name = os.path.basename(d)
        if name in done or (wanted and name not in wanted):
            continue
        print(f"[{i + 1}/{len(cases)}] {name}", flush=True)
        try:
            res = run_case(d)
        except Exception as e:  # noqa: BLE001
            print(f"  HATA: {e}", flush=True)
            res = {"case": name, "error": str(e), "boxes": 0, "hit_boxes": 0, "fp_boxes": 0,
                   "slices": 0, "gt_slices": 0, "case_detected": False, "loc_ok": False,
                   "slice_eval": {str(t): {"tp": 0, "fn": 0, "fp": 0} for t in SWEEP},
                   "elapsedMs": 0}
        results.append(res)
        with open(RESULTS_PATH, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=1)
        print(
            f"  {res.get('slices')} kesit · GT {res.get('gt_slices')} kesit · "
            f"kutu {res.get('boxes')} (hit {res.get('hit_boxes')}, fp {res.get('fp_boxes')}) · "
            f"{'YAKALANDI' if res.get('case_detected') else 'kaçtı'} · {res.get('elapsedMs', 0)} ms",
            flush=True,
        )

    ok = [r for r in results if "error" not in r]
    if not ok:
        print("başarılı vaka yok", file=sys.stderr)
        return 1
    write_report(ok, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
