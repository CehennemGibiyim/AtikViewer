"""BT beyin — intrakraniyal kanama (ICH) derin öğrenme çıkarımı (yerel, ücretsiz).

Model: ianpan/ct-head-hemorrhage-detection (MIT lisans, RSNA ICH eğitimi).
Ağırlıklar ~/.cache/atikviewer-ai/brain altında yerel durur; ağ erişimi gerekmez.
Tüm çıkarım bu makinede çalışır, hasta verisi dışarı ÇIKMAZ, ücret yoktur.

Çıktı kutuları gönderilen hacmin [0,1] normalize uzayındadır (x,y,w,h) ve
kesit indisleri (z0,z1) gönderilen hacimdedir — tıpkı /infer (nodül modeli)
yanıtı gibi; istemci aynı işlevsellikle işler.

UYARI: Model çıktıları aday niteliğindedir; radyoloji uzmanı onayı olmadan
klinik olarak geçerli değildir.
"""

import os
import threading
import time

import numpy as np

CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "atikviewer-ai", "brain")
MODEL_REPO = "ianpan/ct-head-hemorrhage-detection"

# ich_inference.CLASS_NAMES ile birebir aynı sırada:
# epidural, intraparenchymal, intraventricular, subarachnoid, subdural, any
CLASS_NAMES = [
    "epidural",
    "intraparenchymal",
    "intraventricular",
    "subarachnoid",
    "subdural",
    "any",
]
CLASS_TR = {
    "epidural": "Epidural kanama adayı",
    "intraparenchymal": "İntraparankimal kanama adayı",
    "intraventricular": "İntraventriküler kanama adayı",
    "subarachnoid": "Subaraknoid kanama adayı",
    "subdural": "Subdural kanama adayı",
}

# Çıkarım eşiği (slice olasılığı). Üretim varsayılanı 0.30 — nodül modeliyle aynı
# ayarda tutulur ki istemci eşiği tek yerden okuyabilsin.
SCORE_THRESH = float(os.environ.get("ATIK_ICH_THRESH", "0.30"))
# Aynı tipte adayları birleştirirken izin verilen 1 kesitlik boşluk.
GAP_TOLERANCE = 1
# Kayan pencere içinde maske için eşik.
MASK_THRESH = 0.5

_lock = threading.Lock()
_state = {"model": None, "loadError": None}


def model_files_ready() -> bool:
    """Ağırlıklar yerelde mevcut mu? (setup/indirme tamamlanmış mı)

    ich_inference.HemorrhageSliceModel beş segmentasyon fold'unun da ağırlığını
    yükler; eksik fold yükleme anında patladığı için hazırılık denetimi yedi
    dosyanın tamamını ister (setup_model.py BRAIN_FILES ile aynı liste).
    """
    for rel in (
        "classifier/model.safetensors",
        "sequence/model.safetensors",
        "segmentation/fold0.safetensors",
        "segmentation/fold1.safetensors",
        "segmentation/fold2.safetensors",
        "segmentation/fold3.safetensors",
        "segmentation/fold4.safetensors",
    ):
        path = os.path.join(CACHE_DIR, rel)
        if not (os.path.isfile(path) and os.path.getsize(path) > 1_000_000):
            return False
    return True


def get_model():
    """Modeli tembel yükler (ilk çağrıda). Kilitli; aynı anda tek yükleme."""
    if _state["model"] is not None:
        return _state["model"]
    with _lock:
        if _state["model"] is not None:
            return _state["model"]
        if not model_files_ready():
            raise RuntimeError(
                f"Beyin modeli ağırlıkları bulunamadı ({CACHE_DIR}). "
                "`python ai-worker/setup_model.py` çalıştırın."
            )
        import ich_inference  # ağırlık yükleme sırasında import (ağır modüller)

        # Cihaz: varsayılan CPU (üretim); ATIK_ICH_DEVICE=cuda ile GPU kullanılır
        # (doğrulama gibi uzun toplu çalıştırmalar için).
        device = os.environ.get("ATIK_ICH_DEVICE", "cpu")
        model = ich_inference.HemorrhageSliceModel(local_dir=CACHE_DIR, device=device)
        _state["model"] = model
        return model


def _mask_bbox(mask_2d: np.ndarray):
    """[0,1] maskeden (x0,y0,x1,y1) piksel sınır kutusu; boşsa None."""
    ys, xs = np.where(mask_2d > MASK_THRESH)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _map_to_original(bbox_px, orig_hw, resized: bool):
    """Model uzayındaki 512×512 kutuyu orijinal kesit piksel uzayına çevir.

    ich_inference.window_hu_slice iki yol kullanır:
      - herhangi bir boyut >640 ise 512×512'e yeniden boyutlandırır (INTER_AREA),
      - değilse merkezden kırp/ekle (pad ortalanır).
    """
    x0, y0, x1, y1 = bbox_px
    H, W = orig_hw
    if resized:
        sx, sy = W / 512.0, H / 512.0
        x0, x1 = x0 * sx, x1 * sx
        y0, y1 = y0 * sy, y1 * sy
    else:
        if H >= 512:
            top = (H - 512) // 2
            y0, y1 = y0 + top, y1 + top
        else:
            pad_top = (512 - H) // 2
            y0, y1 = y0 - pad_top, y1 - pad_top
        if W >= 512:
            left = (W - 512) // 2
            x0, x1 = x0 + left, x1 + left
        else:
            pad_left = (512 - W) // 2
            x0, x1 = x0 - pad_left, x1 - pad_left
    x0 = max(0.0, min(W - 1.0, x0))
    x1 = max(0.0, min(W - 1.0, x1))
    y0 = max(0.0, min(H - 1.0, y0))
    y1 = max(0.0, min(H - 1.0, y1))
    if x1 <= x0:
        x1 = min(W - 1.0, x0 + 1.0)
    if y1 <= y0:
        y1 = min(H - 1.0, y0 + 1.0)
    return x0, y0, x1, y1


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Boolean kesit maskesinden (başlangıç, bitiş) aralıkları; 1 kesitlik boşlukları birleştirir."""
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return []
    runs: list[list[int]] = [[int(idx[0]), int(idx[0])]]
    for i in idx[1:]:
        i = int(i)
        if i - runs[-1][1] <= 1 + GAP_TOLERANCE:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    return [(a, b) for a, b in runs]


def run_brain_inference(hu_zyx: np.ndarray, include_slice_probs: bool = False) -> dict:
    """(Z,Y,X) HU hacmi üzerinde ICH çıkarımı; /infer ile aynı kutu şemasını döndürür.

    İki aşamalı (CPU-pratik):
      1) Tüm kesitlerde yalnızca sınıflandırma (maske yok) — maliyetin %90'ı burada.
      2) Pozitif aralıkların tepe kesitlerinde maske çıkarımı — kutu konumlanması.

    include_slice_probs=True ile (yalnızca doğrulama/araç amaçlı; üretim yanıtı
    küçük tutmak için varsayılan False) kesit bazlı olasılıklar (Z×6) eklenir.
    """
    model = get_model()
    Z, Y, X = hu_zyx.shape
    t0 = time.time()

    # Model fiziksel sıra (D,H,W) bekler; Z ekseni zaten kesit sırasıdır.
    vol = np.ascontiguousarray(hu_zyx.astype(np.float32))
    out = model.predict_hu_volume(
        vol,
        batch_size=16,
        return_segmentation=False,
        long_series_mode="full" if Z <= 64 else "resample",
    )

    slice_probs = np.asarray(out["slice_classification"], dtype=np.float32)  # (Z,6)
    series_probs = {
        name: float(v)
        for name, v in zip(CLASS_NAMES, np.asarray(out["series_classification"], dtype=np.float32))
    }

    resized = Y > 640 or X > 640
    # (tip, aralık, tepe kesit) — tepe kesit için maske 2. aşamada çıkarılır
    positives: list[tuple[str, int, tuple[int, int], int]] = []
    for ci, name in enumerate(CLASS_NAMES[:5]):
        probs = slice_probs[:, ci]
        for a, b in _runs(probs >= SCORE_THRESH):
            peak = a + int(np.argmax(probs[a : b + 1]))
            positives.append((name, ci, (a, b), peak))
    positives.sort(key=lambda t: -float(slice_probs[t[3], t[1]]))

    # ───── 2. aşama: yalnızca pozitif tepe kesitlerinde maske ─────
    mask_map: dict[int, np.ndarray] = {}
    if positives:
        peaks = sorted({p[3] for p in positives})
        try:
            import ich_inference

            slabs = np.stack([ich_inference.preprocess_hu_volume_slab(vol, i) for i in peaks])
            pred = model.predict(slabs)  # (len(peaks), 6, 512, 512)
            seg = np.asarray(pred["segmentation"], dtype=np.float32)
            mask_map = {p: seg[k] for k, p in enumerate(peaks)}
        except Exception:  # noqa: BLE001 — maske başarısızsa sınıflandırma kutuları korunur
            mask_map = {}

    boxes: list[dict] = []
    for name, ci, (z0, z1), peak in positives:
        score = float(slice_probs[z0 : z1 + 1, ci].max())
        bbox_px = None
        seg_peak = mask_map.get(peak)
        if seg_peak is not None and seg_peak.ndim == 3 and seg_peak.shape[0] > ci:
            bbox_px = _mask_bbox(np.asarray(seg_peak[ci], dtype=np.float32))
        if bbox_px is not None:
            x0, y0, x1, y1 = _map_to_original(bbox_px, (Y, X), resized)
        else:
            # Maske yoksa ortalanmış varsayılan odak kutusu (%40 alan)
            x0, y0, x1, y1 = X * 0.30, Y * 0.30, X * 0.70, Y * 0.70
        nx0, nx1 = sorted((x0 / max(X - 1, 1), x1 / max(X - 1, 1)))
        ny0, ny1 = sorted((y0 / max(Y - 1, 1), y1 / max(Y - 1, 1)))
        if nx1 - nx0 < 0.01 or ny1 - ny0 < 0.01:
            continue
        boxes.append({
            "x": round(min(1.0, max(0.0, nx0)), 4),
            "y": round(min(1.0, max(0.0, ny0)), 4),
            "w": round(min(1.0 - nx0, max(0.01, nx1 - nx0)), 4),
            "h": round(min(1.0 - ny0, max(0.01, ny1 - ny0)), 4),
            "z0": int(max(0, min(Z - 1, z0))),
            "z1": int(max(0, min(Z - 1, z1))),
            "score": round(score, 4),
            "label": CLASS_TR[name],
            "subtype": name,
        })

    # Aynı kesit aralığında üst üste binen farklı alt tipleri tekilleştir (en yüksek skor)
    boxes.sort(key=lambda b: -b["score"])
    deduped: list[dict] = []
    for b in boxes:
        overlap = any(
            b["z0"] <= d["z1"] and b["z1"] >= d["z0"]
            and min(b["x"] + b["w"], d["x"] + d["w"]) - max(b["x"], d["x"]) > 0.15
            and min(b["y"] + b["h"], d["y"] + d["h"]) - max(b["y"], d["y"]) > 0.15
            for d in deduped
        )
        if not overlap:
            deduped.append(b)

    result = {
        "boxes": deduped[:15],
        "series": series_probs,
        "slicePeaks": {name: float(slice_probs[:, i].max()) for i, name in enumerate(CLASS_NAMES)},
        "elapsedMs": int((time.time() - t0) * 1000),
        "model": f"{MODEL_REPO} (MIT, RSNA ICH, yerel çıkarım)",
        "scoreThresh": SCORE_THRESH,
        "protocol": "ct-head",
        "slices": Z,
    }
    if include_slice_probs:
        # Doğrulama modu: eşik taraması için kesit×sınıf olasılık matrisi (Z,6).
        result["sliceProbs"] = [[round(float(v), 5) for v in row] for row in slice_probs]
    return result
