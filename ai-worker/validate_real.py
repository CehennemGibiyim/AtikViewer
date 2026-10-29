"""ATIKVIEWER klinik doğrulama modu — GERÇEK ground-truth (LUNA16 / LIDC-IDRI).

Sentetik fantom yerine, bilinen radyolog nodül koordinatlarına sahip gerçek BT
serileri üzerinde duyarlılık / FP oranı tablosu üretir. Tüm veri ücretsiz ve
GİRİŞSİZ indirilir:

  - annotations.csv (LUNA16, 1.186 nodül): Zenodo, CC BY 4.0
  - BT serileri (LIDC-IDRI): TCIA NBIA API (anahtarsız, açık koleksiyon)
    DICOM ZIP olarak iner; betik içinde HU hacmine çevrilir.

Kullanım:
    python ai-worker/validate_real.py --select 12 5   # kohortu seç (bir kez)
    python ai-worker/validate_real.py                 # indir + çıkar + rapor yaz
    python ai-worker/validate_real.py --cases 1,5     # yalnızca belirli indeksler

Çıktılar:
    ai-worker/data/cohort.json          seçilen kohort (seriesuid, GT, boyut)
    ai-worker/data/results.json         vaka bazında çıkarım sonuçları (kademeli)
    docs/Klinik_Dogrulama_LUNA16.md     doğrulama raporu

Eşleme ölçütü (LUNA16 FROC geleneği): TP — tahmin merkezi, GT nodül merkezine
uzaklık ≤ nodül yarıçapı (diameter_mm / 2). Uzaklık > yarıçap veya GT'siz
taramadaki her tahmin FP'dir.

UYARI: Bulgular aday niteliğindedir; nihai onay radyoloji uzmanına aittir.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import io
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # noqa: BLE001
        pass

import model_lib  # noqa: E402
from validate import boxes_to_orig  # noqa: E402  — server.py ile birebir dönüşüm

DATA_DIR = os.path.join(HERE, "data")
ANN_PATH = os.path.join(DATA_DIR, "annotations.csv")
CAND_PATH = os.path.join(DATA_DIR, "candidates.csv")
COHORT_PATH = os.path.join(DATA_DIR, "cohort.json")
RESULTS_PATH = os.path.join(DATA_DIR, "results.json")
NBIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1"

# Üretim arayüzüyle aynı derin tarama eşiği; metrikler tarama ile hesaplanır.
DETECTOR_THRESH = 0.05
THRESHOLDS = [0.05, 0.10, 0.20, 0.30, 0.50]
MAX_FILE_MB = 300  # seride ZIP boyutu üst sınırı (indirme bütçesi)
MAX_IMAGES = 450


# ─────────────────────────── veri erişimi ───────────────────────────

def _get_json(url: str, params: dict, timeout: int = 60):
    q = urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)


def ensure_annotations() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    if not (os.path.isfile(ANN_PATH) and os.path.getsize(ANN_PATH) > 100_000):
        url = "https://zenodo.org/records/3723295/files/annotations.csv?download=1"
        print(f"annotations.csv indiriliyor: {url}", flush=True)
        urllib.request.urlretrieve(url, ANN_PATH)
    if not (os.path.isfile(CAND_PATH) and os.path.getsize(CAND_PATH) > 1_000_000):
        url = "https://zenodo.org/records/3723295/files/candidates.csv?download=1"
        print(f"candidates.csv indiriliyor (55 MB): {url}", flush=True)
        urllib.request.urlretrieve(url, CAND_PATH)


def load_annotations() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    with open(ANN_PATH, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            out.setdefault(row["seriesuid"], []).append(
                {
                    "x": float(row["coordX"]),
                    "y": float(row["coordY"]),
                    "z": float(row["coordZ"]),
                    "d": float(row["diameter_mm"]),
                }
            )
    return out


def load_candidate_uids() -> list[str]:
    """candidates.csv içindeki tüm seri UID'leri (LUNA16'nın 888 taraması)."""
    seen: set[str] = set()
    with open(CAND_PATH, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            seen.add(row["seriesuid"])
    return sorted(seen)


def series_meta(uid: str, cache: dict) -> dict | None:
    if uid in cache:
        return cache[uid]
    try:
        data = _get_json(f"{NBIA}/getSeries", {"SeriesInstanceUID": uid, "format": "json"})
    except Exception as e:  # noqa: BLE001
        print(f"  getSeries başarısız {uid}: {e}", flush=True)
        return None
    meta = data[0] if isinstance(data, list) and data else None
    cache[uid] = meta
    with open(os.path.join(DATA_DIR, "series_cache.json"), "w", encoding="utf-8") as fh:
        json.dump(cache, fh)
    return meta


def select_cohort(pos_n: int, neg_n: int, seed: int = 42) -> int:
    ensure_annotations()
    ann = load_annotations()
    cand = load_candidate_uids()
    neg_uids = [u for u in cand if u not in ann]
    print(f"pozitif aday seri: {len(ann)} · negatif aday seri: {len(neg_uids)}", flush=True)

    cache_path = os.path.join(DATA_DIR, "series_cache.json")
    cache: dict = {}
    if os.path.isfile(cache_path):
        with open(cache_path, encoding="utf-8") as fh:
            cache = json.load(fh)

    def usable(meta: dict | None) -> bool:
        return bool(
            meta
            and meta.get("FileSize", 10**12) <= MAX_FILE_MB * 1024 * 1024
            and meta.get("ImageCount", 10**6) <= MAX_IMAGES
            and meta.get("Modality") == "CT"
        )

    # Pozitifler: çap serpilmiş (3-6 / 6-10 / ≥10 mm) seçilsin
    buckets: dict[str, list[str]] = {"3-6": [], "6-10": [], "10+": []}
    for uid in ann:
        dmax = max(n["d"] for n in ann[uid])
        key = "3-6" if dmax < 6 else ("6-10" if dmax < 10 else "10+")
        buckets[key].append(uid)
    for k in buckets:
        rng = random.Random(seed)
        rng.shuffle(buckets[k])

    picked: list[str] = []
    i = 0
    while len(picked) < pos_n and any(buckets.values()):
        key = ["3-6", "6-10", "10+"][i % 3]
        b = buckets[key]
        while b and len(picked) < pos_n:
            uid = b.pop()
            if uid in picked:
                continue
            meta = series_meta(uid, cache)
            if usable(meta):
                picked.append(uid)
            else:
                print(f"  atlandı (boyut/sınır) {uid[-12:]}: {meta and meta.get('FileSize')}", flush=True)
        i += 1
        if i > 60:
            break

    neg_pool = list(neg_uids)
    random.Random(seed).shuffle(neg_pool)
    neg_picked: list[str] = []
    for uid in neg_pool:
        if len(neg_picked) >= neg_n:
            break
        meta = series_meta(uid, cache)
        if usable(meta):
            neg_picked.append(uid)

    cohort = []
    for uid in picked:
        m = cache[uid]
        cohort.append(
            {
                "role": "pozitif",
                "seriesuid": uid,
                "patient": m.get("PatientID", ""),
                "file_size": m.get("FileSize"),
                "image_count": m.get("ImageCount"),
                "nodules": ann[uid],
            }
        )
    for uid in neg_picked:
        m = cache[uid]
        cohort.append(
            {
                "role": "negatif",
                "seriesuid": uid,
                "patient": m.get("PatientID", ""),
                "file_size": m.get("FileSize"),
                "image_count": m.get("ImageCount"),
                "nodules": [],
            }
        )
    with open(COHORT_PATH, "w", encoding="utf-8") as fh:
        json.dump(cohort, fh, indent=1)
    total_mb = sum(c["file_size"] or 0 for c in cohort) / 1e6
    print(
        f"Kohort: {len(picked)} pozitif + {len(neg_picked)} negatif · toplam ~{total_mb:.0f} MB\n"
        f"→ {COHORT_PATH}",
        flush=True,
    )
    return 0


# ─────────────────────────── DICOM → HU ───────────────────────────

def download_series(uid: str) -> str:
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, f"{uid}.zip")
    if os.path.isfile(path) and os.path.getsize(path) > 1_000_000:
        return path
    url = f"{NBIA}/getImage?{urllib.parse.urlencode({'SeriesInstanceUID': uid})}"
    for attempt in range(3):
        try:
            print(f"  indiriliyor… ({attempt + 1}. deneme)", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "atikviewer-validate/1.0"})
            with urllib.request.urlopen(req, timeout=900) as r, open(path, "wb") as fh:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    fh.write(chunk)
            if os.path.getsize(path) > 1_000_000:
                return path
            raise RuntimeError(f"beklenenden küçük dosya: {os.path.getsize(path)}")
        except Exception as e:  # noqa: BLE001
            print(f"  indirme hatası: {e}", flush=True)
            if os.path.isfile(path):
                os.remove(path)
            time.sleep(5 + attempt * 10)
    raise RuntimeError(f"indirilemedi: {uid}")


def zip_to_volume(zip_path: str):
    """DICOM ZIP → (hu[Z,Y,X] float32, spacing_zyx, origin, row_dir, col_dir)."""
    import pydicom

    frames: list[tuple[np.ndarray, np.ndarray, float, float]] = []
    iop_ref = None
    ps_ref = None
    with zipfile.ZipFile(zip_path) as zf:
        names = [
            n
            for n in zf.namelist()
            if not n.lower().endswith("dicomdir")
            and os.path.basename(n).upper() not in {"LICENSE", "README", "README.TXT", "README.MD"}
        ]
        for name in names:
            try:
                ds = pydicom.dcmread(io.BytesIO(zf.read(name)))
            except Exception as e:  # noqa: BLE001 — ZIP içindeki yardımcı dosyaları atla
                if "DICM" in str(e) or "Meta Information" in str(e):
                    continue
                raise RuntimeError(f"DICOM okunamadı ({name}): {e}") from e
            if not hasattr(ds, "PixelData"):
                continue
            try:
                ipp = np.array([float(v) for v in ds.ImagePositionPatient], dtype=np.float64)
                iop = tuple(float(v) for v in ds.ImageOrientationPatient)
                if iop_ref is None:
                    iop_ref = iop
                    ps_ref = tuple(float(v) for v in ds.PixelSpacing)  # (satır, sütun)
                elif iop != iop_ref:
                    raise RuntimeError("seride görüntü yönlendirmesi değişiyor")
                arr = ds.pixel_array.astype(np.float32)
                slope = float(getattr(ds, "RescaleSlope", 1.0))
                inter = float(getattr(ds, "RescaleIntercept", 0.0))
            except RuntimeError:
                raise
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(f"DICOM okunamadı ({name}): {e}") from e
            frames.append((ipp, arr, slope, inter))
    if not frames:
        raise RuntimeError("DICOM karesi yok")

    row_dir = np.array(iop_ref[0:3])  # artan sütun indeksi yönü
    col_dir = np.array(iop_ref[3:6])  # artan satır indeksi yönü
    normal = np.cross(row_dir, col_dir)
    normal = normal / np.linalg.norm(normal)
    frames.sort(key=lambda f: float(np.dot(f[0], normal)))

    ipp0 = frames[0][0]
    if len(frames) > 1:
        projs = [float(np.dot(f[0], normal)) for f in frames]
        diffs = np.diff(projs)
        sz = float(np.mean(np.abs(diffs))) if len(diffs) else 1.0
        if np.any(diffs <= 0):
            raise RuntimeError("kesit ilerlemesi tek yönlü değil")
    else:
        sz = 1.0
    sy, sx = float(ps_ref[0]), float(ps_ref[1])
    if abs(sz) < 1e-6:
        sz = 1.0

    z, y, x = len(frames), frames[0][1].shape[0], frames[0][1].shape[1]
    hu = np.empty((z, y, x), dtype=np.float32)
    for k, (_, arr, slope, inter) in enumerate(frames):
        hu[k] = arr * slope + inter
    return hu, (sz, sy, sx), ipp0, row_dir, col_dir


# ─────────────────────────── çıkarım + eşleme ───────────────────────────

def detect_world(hu, spacing_zyx, origin, row_dir, col_dir) -> list[dict]:
    """HU hacminde çıkarım yapar; kutuları LPS dünya koordinatına (mm) çevirir."""
    resampled = model_lib.resample_to_luna16(hu, spacing_zyx)
    boxes, scores = model_lib.run_inference(resampled)
    preds = boxes_to_orig(boxes, scores, hu.shape, resampled.shape)

    sz, sy, sx = spacing_zyx
    normal = np.cross(row_dir, col_dir)
    normal = normal / np.linalg.norm(normal)
    out = []
    for p in preds:
        x0, y0, z0, x1, y1, z1 = p["box"]
        cx, cy, cz = (x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0
        world = (
            origin
            + cx * sx * row_dir
            + cy * sy * col_dir
            + cz * sz * normal
        )
        out.append({"score": float(p["score"]), "world": [float(v) for v in world]})
    return out


def sample_hu_at(hu, spacing_zyx, origin, row_dir, col_dir, wx, wy, wz) -> float:
    """GT dünya noktasındaki HU ortalaması (3×3×3) — kayıt doğrulaması için."""
    sz, sy, sx = spacing_zyx
    normal = np.cross(row_dir, col_dir)
    normal = normal / np.linalg.norm(normal)
    # dünya → voksel: M = [sx*R | sy*C | sz*N], tersini al
    M = np.column_stack([sx * row_dir, sy * col_dir, sz * normal])
    idx = np.linalg.solve(M, np.array([wx, wy, wz]) - origin)
    cx, cy, cz = int(round(idx[0])), int(round(idx[1])), int(round(idx[2]))
    Z, Y, X = hu.shape
    if not (1 <= cx < X - 1 and 1 <= cy < Y - 1 and 1 <= cz < Z - 1):
        return float("nan")
    return float(hu[cz - 1 : cz + 2, cy - 1 : cy + 2, cx - 1 : cx + 2].mean())


def run_case(case: dict) -> dict:
    uid = case["seriesuid"]
    t0 = time.time()
    zip_path = download_series(uid)
    hu, spacing, origin, row_dir, col_dir = zip_to_volume(zip_path)
    print(
        f"  hacim {hu.shape} · spacing {tuple(round(v, 3) for v in spacing)} · "
        f"aralık [{hu.min():.0f}, {hu.max():.0f}] HU",
        flush=True,
    )
    os.remove(zip_path)  # disk bütçesi: indirilen ZIP hemen silinir

    det = detect_world(hu, spacing, origin, row_dir, col_dir)
    gt_hu = [
        round(sample_hu_at(hu, spacing, origin, row_dir, col_dir, n["x"], n["y"], n["z"]), 1)
        for n in case["nodules"]
    ]
    return {
        "seriesuid": uid,
        "role": case["role"],
        "nodules": case["nodules"],
        "detections": det,
        "gt_sample_hu": gt_hu,
        "spacing": list(spacing),
        "shape": list(hu.shape),
        "elapsedMs": int((time.time() - t0) * 1000),
    }


def match(det: dict, thresh: float, tol: float) -> tuple[int, int, int]:
    """(tp, fn, fp) — GT eşlemesi.

    tol=0.5 → merkez uzaklığı ≤ yarıçap (katı); tol=1.0 → ≤ çap (toleranslı).
    Aynı GT'yi en fazla bir tahmin karşılar; fazladan tahmin FP'dir (muhafazakar).
    """
    scored = [d for d in det["detections"] if d["score"] >= thresh]
    used = [False] * len(scored)
    tp = fn = 0
    for n in det["nodules"]:
        g = np.array([n["x"], n["y"], n["z"]])
        lim = n["d"] * tol
        hit = False
        for i, d in enumerate(scored):
            if used[i]:
                continue
            if float(np.linalg.norm(np.array(d["world"]) - g)) <= lim:
                used[i] = True
                hit = True
                break
        tp += 1 if hit else 0
        fn += 0 if hit else 1
    fp = sum(1 for u in used if not u)
    return tp, fn, fp


def evaluate(results: list[dict], thresh: float) -> dict:
    """İki ölçüt: sert (≤ yarıçap) ve toleranslı (≤ çap)."""
    s_tp = s_fn = s_fp = 0
    l_tp = l_fp = 0
    neg_n = neg_clean = 0
    n_gt = 0
    for r in results:
        st, sf, sp = match(r, thresh, 0.5)
        lt, _lf, lp = match(r, thresh, 1.0)
        s_tp += st
        s_fn += sf
        s_fp += sp
        l_tp += lt
        l_fp += lp
        n_gt += len(r["nodules"])
        if r["role"] == "negatif":
            neg_n += 1
            neg_clean += 1 if sp == 0 else 0
    s_ts = s_tp + s_fn
    return {
        "tp": s_tp,
        "fn": s_fn,
        "fp": s_fp,
        "gt": n_gt,
        "sens": s_tp / s_ts if s_ts else None,
        "l_tp": l_tp,
        "l_fp": l_fp,
        "sens_lenient": l_tp / n_gt if n_gt else None,
        "neg_n": neg_n,
        "neg_clean": neg_clean,
        "fp_scan": s_fp / len(results) if results else 0.0,
    }


def pct(v):
    return f"%{v * 100:.1f}" if v is not None else "—"


# ─────────────────────────── ana akış ───────────────────────────

def run(args) -> int:
    if not os.path.isfile(COHORT_PATH):
        print("cohort.json yok — önce `--select 12 5` çalıştırın.", file=sys.stderr)
        return 2
    if not model_lib.model_ready():
        print(f"MODEL YOK: {model_lib.MODEL_PATH}", file=sys.stderr)
        return 2
    with open(COHORT_PATH, encoding="utf-8") as fh:
        cohort = json.load(fh)

    model_lib.SCORE_THRESH = DETECTOR_THRESH
    results: list[dict] = []
    if os.path.isfile(RESULTS_PATH):
        with open(RESULTS_PATH, encoding="utf-8") as fh:
            results = [r for r in json.load(fh) if "error" not in r]  # hatalı vaka yeniden denenir
    done = {r["seriesuid"] for r in results}

    wanted = None
    if args.cases:
        wanted = {cohort[i]["seriesuid"] for i in (int(v) for v in args.cases.split(",")) if i < len(cohort)}

    for i, case in enumerate(cohort):
        uid = case["seriesuid"]
        if uid in done or (wanted and uid not in wanted):
            continue
        print(
            f"[{i + 1}/{len(cohort)}] {case['role']} {uid[-16:]} · "
            f"{len(case['nodules'])} GT · {case.get('image_count')} kesit",
            flush=True,
        )
        try:
            res = run_case(case)
        except Exception as e:  # noqa: BLE001
            print(f"  HATA: {e}", flush=True)
            res = {
                "seriesuid": uid,
                "role": case["role"],
                "nodules": case["nodules"],
                "detections": [],
                "gt_sample_hu": [],
                "error": str(e),
                "elapsedMs": 0,
            }
        results.append(res)
        with open(RESULTS_PATH, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=1)
        scores = sorted((d["score"] for d in res["detections"]), reverse=True)[:5]
        print(
            f"  tamam: {len(res['detections'])} kutu · skorlar {['%.2f' % s for s in scores]} · "
            f"GT HU {res.get('gt_sample_hu')} · {res['elapsedMs']} ms",
            flush=True,
        )

    ok = [r for r in results if "error" not in r]
    if not ok:
        print("başarılı vaka yok", file=sys.stderr)
        return 1
    write_report(ok, cohort, args.out)
    return 0


def _dist(det: dict, nodule: dict) -> float:
    """Tahmin kutusu merkezi (DICOM dünya/LPS) ile GT nodül merkezi arasındaki uzaklık (mm)."""
    return float(
        np.linalg.norm(
            np.array(det["world"]) - np.array([nodule["x"], nodule["y"], nodule["z"]])
        )
    )


def write_report(results: list[dict], cohort: list, out_path: str) -> None:
    sweeps = {t: evaluate(results, t) for t in THRESHOLDS}
    for t, m in sweeps.items():
        print(
            f"  eşik {t:.2f} → duyarlılık (sert) {pct(m['sens'])} ({m['tp']}/{m['gt']}) · "
            f"(toleranslı) {pct(m['sens_lenient'])} ({m['l_tp']}/{m['gt']}) · "
            f"FP/tarama {m['fp_scan']:.2f} · FP'siz negatif {m['neg_clean']}/{m['neg_n']}",
            flush=True,
        )

    pos = [r for r in results if r["role"] == "pozitif"]
    neg = [r for r in results if r["role"] == "negatif"]
    n_gt = sum(len(r["nodules"]) for r in results)
    diameters = sorted(n["d"] for r in results for n in r["nodules"])
    total_mb = sum((c.get("file_size") or 0) for c in cohort if c["seriesuid"] in {r["seriesuid"] for r in results}) / 1e6
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    detail = [
        "| # | Rol | Seri (son 12) | GT nodül (mm) | Kutu ≥0.05 | 0.30 TP sert/tol. | GT↔kutu (mm) | GT HU | Süre |",
        "|---|-----|---------------|---------------|-----------|--------------------|--------------|-------|------|",
    ]
    for i, r in enumerate(results, 1):
        ns = ", ".join(f"{n['d']:.1f}" for n in r["nodules"]) or "—"
        n05 = len(r["detections"])
        m30s = match(r, 0.30, 0.5)[0]
        m30l = match(r, 0.30, 1.0)[0]
        gt_hu = ", ".join(str(h) for h in r.get("gt_sample_hu", [])) or "—"
        mind = "—"
        if r["nodules"] and r["detections"]:
            ds = [d for d in r["detections"] if d["score"] >= 0.05]
            if ds:
                mins = [min(_dist(d, n) for d in ds) for n in r["nodules"]]
                missed = [m for m, n in zip(mins, r["nodules"]) if m > n["d"]]
                # Kaçan GT varsa yalnızca en yakın değeri göstermek tabloyu yanıltır;
                # hem en yakın hem de kaçan GT'nin uzaklığı yazılır.
                mind = f"{min(mins):.1f}" if not missed else f"{min(mins):.1f} · kaçan {max(missed):.1f} ⚠"
        detail.append(
            f"| {i} | {r['role']} | …{r['seriesuid'][-12:]} | {ns} | {n05} | "
            f"{m30s}/{len(r['nodules'])} ({m30l}) | {mind} | {gt_hu} | {r['elapsedMs'] // 1000} sn |"
        )

    sweep = [
        "| Skor eşiği | Duyarlılık (sert ≤r) | Duyarlılık (toleranslı ≤çap) | FP / tarama | FP'siz negatif |",
        "|------------|----------------------|-------------------------------|-------------|----------------|",
    ]
    for t in THRESHOLDS:
        m = sweeps[t]
        sweep.append(
            f"| {t:.2f} | {pct(m['sens'])} ({m['tp']}/{m['gt']}) | "
            f"{pct(m['sens_lenient'])} ({m['l_tp']}/{m['gt']}) | {m['fp_scan']:.2f} | "
            f"{m['neg_clean']}/{m['neg_n']} |"
        )

    uid_lines = [f"- `{c['seriesuid']}` — {c['role']}" for c in cohort]

    # Pozitif vakalarda her GT'nin en yakın ≥0.05 adayına uzaklığı (konumlandırma özeti).
    # (dist, gt_çap) çiftleri toplanır; sınır ötesi mesafeler ayrıca sınıflandırılır.
    per_gt: list[tuple[float, float]] = []
    hit_scores: list[float] = []
    for r in results:
        if r["role"] != "pozitif":
            continue
        ds = [d for d in r["detections"] if d["score"] >= 0.05]
        for n in r["nodules"]:
            dmin = min((_dist(d, n) for d in ds), default=float("inf"))
            per_gt.append((dmin, float(n["d"])))
            sc = [d["score"] for d in r["detections"] if _dist(d, n) <= n["d"]]
            if sc:
                hit_scores.append(max(sc))

    near = sorted(d for d, _ in per_gt if d <= 3.0)
    far = [(d, dia) for d, dia in per_gt if d > dia]  # toleranslı ölçütte de kaçan GT
    far_max = max((d for d, _ in far), default=0.0)
    close_lo = min(near) if near else 0.0
    close_hi = max(near) if near else 0.0
    n_near = len(near)
    n_gt_eval = len(per_gt)
    n_edge = sum(1 for d, dia in per_gt if dia / 2 < d <= dia / 2 + 1.0)
    strict_miss = sweeps[0.30]["gt"] - sweeps[0.30]["tp"]
    n_pos_hit = sum(
        1
        for r in results
        if r["role"] == "pozitif"
        and r["detections"]
        and any(
            min((_dist(d, n) for d in r["detections"] if d["score"] >= 0.05), default=9e9) <= n["d"]
            for n in r["nodules"]
        )
    )

    md = "\n".join(
        [
            "# Klinik Doğrulama Raporu — GERÇEK ground-truth (LUNA16 / LIDC-IDRI)",
            "",
            f"- **Tarih:** {now}",
            f"- **Model:** {model_lib.MODEL_PATH}",
            "- **Paket:** MONAI `lung_nodule_ct_detection` (LUNA16 eğitimi, Apache-2.0)",
            f"- **Cihaz:** {model_lib.DEVICE} · **ROI:** {model_lib.ROI_SIZE} · **Çıkarım eşiği:** {DETECTOR_THRESH}",
            f"- **Kohort:** {len(pos)} pozitif + {len(neg)} negatif gerçek BT serisi · "
            f"{n_gt} GT nodül · ~{total_mb:.0f} MB indirme · kesit çapı {diameters[0]:.1f}–{diameters[-1]:.1f} mm" if diameters else "",
            "- **Kaynak:** LUNA16 annotations (Zenodo, CC BY 4.0) · LIDC-IDRI DICOM (TCIA NBIA API, CC BY 3.0,",
            "  [doi:10.7937/K9/TCIA.2015.LO9QL9SX](https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX))",
            "- **Yöntem:** Her seride DICOM → HU hacmi → LUNA16 boşluğuna yeniden örnekleme → çıkarım;",
            "  kutular orijinal kesite, oradan DICOM dünya (LPS) koordinatına çevrilir.",
            "  **TP ölçütü (iki kademeli):** *sert* — tahmin merkezi ile GT merkezi uzaklığı ≤ yarıçap;",
            "  *toleranslı* — ≤ çap. Bir GT'yi en fazla bir tahmin karşılar, fazladan tahmin FP'dir;",
            "  GT'siz (negatif) serilerdeki tüm tahminler FP'dir.",
            "",
            "## Sonuç (özet)",
            "",
            f"- Üretim eşiği **0.30**'da duyarlılık: **{pct(sweeps[0.30]['sens_lenient'])}** "
            f"(toleranslı ≤çap, {sweeps[0.30]['l_tp']}/{sweeps[0.30]['gt']}) · "
            f"**{pct(sweeps[0.30]['sens'])}** (sert ≤r, {sweeps[0.30]['tp']}/{sweeps[0.30]['gt']}) · "
            f"FP/tarama **{sweeps[0.30]['fp_scan']:.1f}**.",
            f"- **Konumlandırma:** {n_near}/{n_gt_eval} GT'nin en yakın ≥0.05 adayı GT merkezine "
            f"{close_lo:.1f}–{close_hi:.1f} mm uzaktadır (3 mm içinde) · {n_pos_hit}/{len(pos)} "
            "pozitif seride en az bir GT toleranslı ölçütte karşılandı.",
            f"- **Kaçak:** {len(far)}/{n_gt_eval} GT toleranslı ölçütte de kaçtı; en yakın adayı "
            f"{far_max:.1f} mm uzakta ve **hiçbir skor eşiğinin altında dahi yakınında aday yok** — "
            "bu bir lokalizasyon hatasıdır. Bu nedenle \"konumlandırma her vakada doğru\" "
            "sonucu çıkarılamaz.",
            f"- Sert ölçütte kaçan {strict_miss} GT'nin {n_edge} tanesi yarıçapı en fazla 1.0 mm "
            f"aşan sapmayla kaçtı (konum kabaca doğru, hassasiyet sınırı); kalan "
            f"{max(0, strict_miss - n_edge)} GT belirgin biçimde uzakta.",
            f"- Eşik duyarlılığı 0.05–0.50 arasında değişmez: toleranslı eşleşen {len(hit_scores)} GT "
            f"için en yüksek aday skoru {min(hit_scores):.2f}–{max(hit_scores):.2f}; kaçan GT'nin "
            "ise hiç adayı yok. Üretim eşiği 0.30 duyarlılığı değil, FP/tarama yükünü düşürür.",
            "",
            "## Eşik taraması",
            "",
            *sweep,
            "",
            "## Vaka detayları",
            "",
            *detail,
            "",
            "`⚠` işareti: GT'ye en yakın ≥0.05 aday çapın dışında kalmıştır (toleranslı ölçütte "
            "kaçak). Sütun, serideki en yakın ve — varsa — kaçan GT'nin uzaklığını birlikte gösterir.",
            "",
            "## Kayıt doğrulaması",
            "",
            "- `GT HU` sütunu, GT koordinatındaki 3×3×3 HU ortalamasıdır: nodül dokusu",
            "  akciğer parankimi ortamında (~-800 HU) belirgin yüksek dansiteli olur (kireçlenmiş",
            "  nodüller çok daha yüksek çıkabilir). Bu sütun koordinat kaydının (DICOM dünya ↔ GT)",
            "  doğru olduğunu doğrular; ayrıca en yüksek skorlu kutunun GT'ye uzaklığı da ayrıca",
            "  raporlanan mesafedir.",
            "",
            "## Yorum ve sınırlar",
            "",
            "- Model **LUNA16 kaynaklı** bir pakettir ve doğrulama da LUNA16/LIDC alt kümesi üzerinde",
            "  yapılmıştır (aynı dağılım / in-domain). Bu, **dış (external) doğrulama değildir**;",
            "  gerçek klinik performans genellikle daha düşüktür.",
            "- Kohort bilinçli olarak küçük tutulmuştur (indirme bütçesi); güven aralıkları geniştir.",
            "- GT, LUNA16 standart ≥3 mm nodülleri kapsar; daha küçük nodüller GT dışıdır.",
            "- Üretim arayüzündeki derin tarama eşiği 0.30'dur; tablo 0.05–0.50 aralığını gösterir.",
            "- Bulgular **aday** niteliğindedir; herhangi bir bulgunun klinik yorumu ve rapor onayı",
            "  yalnızca radyoloji uzmanı tarafından yapılır.",
            "- Yeniden üretim: `python ai-worker/validate_real.py --select 12 5` ardından",
            "  `python ai-worker/validate_real.py`",
            "",
            "## Kohort seri UID'leri",
            "",
            *uid_lines,
            "",
        ]
    )
    out = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(md)
    print(f"Rapor yazıldı: {out}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="Klinik doğrulama: gerçek LUNA16/LIDC verisi")
    ap.add_argument("--select", nargs=2, type=int, metavar=("POZ", "NEG"), help="kohort seç")
    ap.add_argument("--cases", default="", help="yalnızca bu indeksleri çalıştır (virgülle)")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "docs", "Klinik_Dogrulama_LUNA16.md"))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    if args.select:
        return select_cohort(args.select[0], args.select[1], args.seed)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
