"""ATIKVIEWER yerel derin AI worker'ı — akciğer nodülü tespiti.

Ücretsizdir; yalnızca 127.0.0.1:8787 üzerinde dinler, ağ dışına çıkmaz.
Hasta verisi dışarı gönderilmez; tüm çıkarım bu makinede çalışır.

Protokol:
  GET  /health  -> {"ok":true,"modelLoaded":bool,"brain":{...},...}
  POST /infer?dims=Z,Y,X&spacing=sz,sy,sx[&protocol=ct-chest|ct-head]
       başlık yerine query; gövde = gzip(int16 HU dizisi, little-endian)
       yanıt = {"boxes":[{"x","y","w","h","z0","z1","score"}], "elapsedMs":N, ...}
       Kutular [0,1] normalleştirilmiş (gönderilen hacmin), z0/z1 kesit indisleri.
       protocol=ct-head → yerel ICH modeli (brain_lib) devreye girer; yanıta
       "label" (kanama alt tipi), "series" ve "slicePeaks" eklenir.

Kurulum: python ai-worker/setup_model.py (model dosyalarını indirir).
"""

import gzip
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Windows konsolları (cp1254/cp852) varsayılan olarak UTF-8 yazmaz; Türkçe
# karakterler ve "·" gibi semboller bozuk çıkar. Konsolu UTF-8'e zorla.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # noqa: BLE001 — azami uyumlu çıktı akışı yoksa sessiz geç
        pass

HOST = os.environ.get("ATIK_WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("ATIK_WORKER_PORT", "8787"))
MAX_BODY = int(os.environ.get("ATIK_MAX_BODY_MB", "600")) * 1024 * 1024

import model_lib  # noqa: E402
import brain_lib  # noqa: E402

_infer_lock = threading.Lock()
_load_lock = threading.Lock()
_brain_lock = threading.Lock()


def _ensure_model():
    if not model_lib.model_ready():
        return False, (
            "Model dosyası bulunamadı: "
            f"{model_lib.MODEL_PATH}. `python ai-worker/setup_model.py` çalıştırın."
        )
    try:
        with _load_lock:
            model_lib.get_inferer()  # ilk çağrıda yükler
        return True, ""
    except Exception as e:  # noqa: BLE001 — yüklenemezse net mesaj döner
        return False, f"Model yüklenemedi: {e}"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # sade, konsolu şişirmez
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def _send(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            ready = model_lib.model_ready()
            loaded = model_lib._state["inferer"] is not None
            brain_ready = brain_lib.model_files_ready()
            brain_loaded = brain_lib._state["model"] is not None
            self._send({
                "ok": True,
                "modelLoaded": loaded,
                "modelFile": ready,
                "roi": list(model_lib.ROI_SIZE),
                "brain": {"modelFile": brain_ready, "modelLoaded": brain_loaded},
            })
        else:
            self._send({"error": "not found"}, 404)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/infer":
            self._send({"error": "not found"}, 404)
            return
        qs = parse_qs(parsed.query)
        protocol = (qs.get("protocol") or ["ct-chest"])[0].strip().lower()
        if protocol not in ("ct-chest", "ct-head"):
            self._send({"error": f"Bilinmeyen protocol: {protocol}"}, 400)
            return
        try:
            dims = [int(v) for v in qs["dims"][0].split(",")]  # Z,Y,X
            spacing = [float(v) for v in qs["spacing"][0].split(",")]  # sz,sy,sx
            if len(dims) != 3 or len(spacing) != 3:
                raise ValueError("dims/spacing 3 elemanlı olmalı")
        except Exception as e:  # noqa: BLE001
            self._send({"error": f"Geçersiz parametre: {e}"}, 400)
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._send({"error": f"Geçersiz gövde boyutu ({length})"}, 400)
            return
        raw = self.rfile.read(length)
        try:
            buf = gzip.decompress(raw)
        except Exception:  # noqa: BLE001 — sıkıştırılmamış gönderime de izin ver
            buf = raw
        z, y, x = dims
        expected = z * y * x * 2
        if len(buf) != expected:
            self._send({"error": f"Veri boyutu tutmuyor: {len(buf)} != {expected}"}, 400)
            return
        hu = np.frombuffer(buf, dtype="<i2").reshape(z, y, x).astype(np.float32)

        # ───── BT beyin: yerel ICH derin öğrenme modeli ─────
        if protocol == "ct-head":
            try:
                brain_lib.get_model()  # ilk çağrıda yükler; hazır değilse hata fırlatır
            except Exception as e:  # noqa: BLE001
                self._send({"error": f"Beyin modeli yüklenemedi: {e}"}, 503)
                return
            try:
                with _brain_lock:
                    res = brain_lib.run_brain_inference(hu)
            except Exception as e:  # noqa: BLE001
                self._send({"error": f"Beyin çıkarım hatası: {e}"}, 500)
                return
            self._send(res)
            return

        ok, err = _ensure_model()
        if not ok:
            self._send({"error": err}, 503)
            return

        t0 = time.time()
        try:
            with _infer_lock:
                resampled = model_lib.resample_to_luna16(hu, spacing)
                boxes, scores = model_lib.run_inference(resampled)
        except Exception as e:  # noqa: BLE001
            self._send({"error": f"Çıkarım hatası: {e}"}, 500)
            return
        elapsed = int((time.time() - t0) * 1000)

        # Model uzayındaki xyzxyz kutularını orijinal (Z,Y,X) birimine çevir:
        # 1) resampled (X',Y',Z') -> RAS -> LPS (x/y flip geri)
        # 2) ölçek: orig = (res + 0.5) * (orig_n / res_n) - 0.5  (align_corners=False)
        nx_r, ny_r, nz_r = resampled.shape
        out = []
        for b, s in zip(boxes, scores):
            x0, y0, z0, x1, y1, z1 = [float(v) for v in b]
            if x1 < x0:
                x0, x1 = x1, x0
            if y1 < y0:
                y0, y1 = y1, y0
            if z1 < z0:
                z0, z1 = z1, z0
            # resampled -> flip geri (i -> n-1-i): önce ters çevir, sonra ölçekle
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
            # Normalize [0,1] (gönderilen hacmin) + kesit indisleri
            nx0, nx1 = sorted((ox0 / max(x - 1, 1), ox1 / max(x - 1, 1)))
            ny0, ny1 = sorted((oy0 / max(y - 1, 1), oy1 / max(y - 1, 1)))
            sz0, sz1 = sorted((oz0, oz1))
            if nx1 - nx0 < 0.005 and ny1 - ny0 < 0.005:
                continue  # anlamsız derecede küçük kutu
            out.append({
                "x": round(min(1.0, max(0.0, nx0)), 4),
                "y": round(min(1.0, max(0.0, ny0)), 4),
                "w": round(min(1.0, max(0.004, nx1 - nx0)), 4),
                "h": round(min(1.0, max(0.004, ny1 - ny0)), 4),
                "z0": int(max(0, min(z - 1, round(sz0)))),
                "z1": int(max(0, min(z - 1, round(sz1)))),
                "score": round(float(s), 4),
            })
        out.sort(key=lambda b: -b["score"])
        self._send({
            "boxes": out[:20],
            "elapsedMs": elapsed,
            "resampled": [nx_r, ny_r, nz_r],
            "model": "MONAI lung_nodule_ct_detection (LUNA16, Apache-2.0)",
            "scoreThresh": model_lib.SCORE_THRESH,
            "roi": list(model_lib.ROI_SIZE),
        })


def main():
    print(f"ATIKVIEWER AI worker: http://{HOST}:{PORT} · model={model_lib.MODEL_PATH}", flush=True)
    if brain_lib.model_files_ready():
        print(f"Beyin (ICH) modeli hazır: {brain_lib.CACHE_DIR} · ilk istekte yüklenir.", flush=True)
    else:
        print(f"UYARI: beyin modeli ağırlıkları yok ({brain_lib.CACHE_DIR}); /infer?protocol=ct-head 503 döner.", flush=True)
    if not model_lib.model_ready():
        print(f"UYARI: model dosyası yok ({model_lib.MODEL_PATH}); /infer 503 döner.", flush=True)
    else:
        # Modeli şimdiden yükle ki ilk istek beklemesin
        ok, err = _ensure_model()
        print("Model yüklendi." if ok else f"Model yüklenemedi: {err}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
