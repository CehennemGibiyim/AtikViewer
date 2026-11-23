"""BT beyin uçtan uca testi: worker /infer?protocol=ct-head çağrısı.

Gerçekçi boyutlu sentetik kafa hacmi (kemik halka + beyin dokusu + hiperdense
lezyon adayı) gzip'lenir, worker'a gönderilir; yanıt şeması doğrulanır.
Ağ/bağımlılık GEREKTİRMEZ — yalnızca 127.0.0.1:8787.
"""
import gzip
import json
import os
import sys
import time
import urllib.request

import numpy as np

WORKER = os.environ.get("AI_WORKER_URL", "http://127.0.0.1:8787")
Z, Y, X = 8, 128, 128  # az kesit, hızlı
SZ, SY, SX = 2.5, 1.0, 1.0  # mm


def make_head() -> np.ndarray:
    hu = np.full((Z, Y, X), -1000.0, dtype=np.float32)
    yy, xx = np.meshgrid(np.linspace(-1, 1, Y), np.linspace(-1, 1, X), indexing="ij")
    r = np.sqrt(yy**2 + xx**2)
    brain = r < 0.72
    skull = (r >= 0.72) & (r < 0.86)
    for z in range(Z):
        sl = hu[z]
        sl[brain] = 35.0
        sl[skull] = 900.0
    # Hiperdense lezyon adayı (3. kesit, intraparenchymal benzeri)
    hu[3, 54:70, 58:76] = 65.0
    hu[4, 56:68, 60:74] = 58.0
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 8, size=hu.shape).astype(np.float32)
    mask3d = np.broadcast_to(brain[np.newaxis, :, :], hu.shape)
    hu[mask3d] += noise[mask3d]
    return hu


def main() -> int:
    hu = make_head()
    raw = hu.astype("<i2").tobytes()
    body = gzip.compress(raw)
    url = f"{WORKER}/infer?dims={Z},{Y},{X}&spacing={SZ},{SY},{SX}&protocol=ct-head"
    print(f"POST {url} · gövde {len(raw)} B (gzip {len(body)} B)", flush=True)
    t0 = time.time()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(req, timeout=1800) as r:
            status = r.status
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: istek hatası: {e}", flush=True)
        return 1
    dt = time.time() - t0
    print(f"HTTP {status} · {dt:.1f}s", flush=True)
    print(json.dumps(data, ensure_ascii=False)[:2000], flush=True)

    if status != 200 or data.get("error"):
        print("FAIL: worker hatası", flush=True)
        return 1
    boxes = data.get("boxes")
    if not isinstance(boxes, list):
        print("FAIL: boxes listesi yok", flush=True)
        return 1
    for b in boxes:
        for k in ("x", "y", "w", "h", "z0", "z1", "score", "label"):
            if k not in b:
                print(f"FAIL: kutuda {k} alanı eksik: {b}", flush=True)
                return 1
        if not (0 <= b["x"] <= 1 and 0 <= b["y"] <= 1 and b["w"] > 0 and b["h"] > 0 and 0 <= b["z0"] <= b["z1"] <= Z - 1):
            print(f"FAIL: kutu sınırları yanlış: {b}", flush=True)
            return 1
    print(f"OK: {len(boxes)} kutu · şema ve sınırlar geçerli", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
