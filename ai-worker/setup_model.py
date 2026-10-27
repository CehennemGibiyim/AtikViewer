"""MONAI lung_nodule_ct_detection bundle dosyalarını indirir (ücretsiz, Apache-2.0).

Kullanım:
    python ai-worker/setup_model.py

Dosyalar ATIK_MODEL_DIR (varsayılan ~/.cache/atikviewer-ai/model) altına iner:
    model.pt            (≈84 MB, LUNA16 eğitimi RetinaNet+ResNet50-3D)
    inference.json      (bundle ön işleme/yapılandırma — model_lib ile birebir)
    metadata.json
    scripts/*.py        (bundle inferer yardımcıları — model_lib'in import ettiği dosya)

Mevcut ve boyutu doğrulanmış dosyalar atlanır (idempotent).
"""

import hashlib
import os
import sys
import urllib.request

BASE = "https://huggingface.co/MONAI/lung_nodule_ct_detection/resolve/main"
MODEL_DIR = os.environ.get(
    "ATIK_MODEL_DIR",
    os.path.join(os.path.expanduser("~"), ".cache", "atikviewer-ai", "model"),
)

# (uzak yol, yerel ad, beklenen bayt; None ise boyut kontrolü yapılmaz)
FILES = [
    ("models/model.pt", "model.pt", 83709381),
    ("configs/inference.json", "inference.json", None),
    ("configs/metadata.json", "metadata.json", None),
    ("scripts/detection_inferer.py", os.path.join("scripts", "detection_inferer.py"), None),
    ("scripts/detection_saver.py", os.path.join("scripts", "detection_saver.py"), None),
    ("scripts/evaluator.py", os.path.join("scripts", "evaluator.py"), None),
    # NOT: scripts/__init__.py BİLEREK indirilmez; upstream dosya indirilmemiş
    # trainer.py'yi import ettiği için model yüklemeyi bozar. scripts/ bir
    # "namespace package" olarak çalışır (doğrulanmış durum).
]


def download(url: str, dest: str) -> None:
    tmp = dest + ".part"
    print(f"  indiriliyor: {url}", flush=True)
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, dest)


def main() -> int:
    os.makedirs(MODEL_DIR, exist_ok=True)
    missing = 0
    for remote, local, size in FILES:
        dest = os.path.join(MODEL_DIR, local)
        if os.path.isfile(dest):
            actual = os.path.getsize(dest)
            if size is None or actual == size:
                print(f"  atlandı (mevcut): {local} ({actual} bayt)", flush=True)
                continue
            print(f"  boyut uyuşmuyor ({actual} != {size}), yeniden indiriliyor: {local}", flush=True)
        os.makedirs(os.path.dirname(dest) or MODEL_DIR, exist_ok=True)
        try:
            download(f"{BASE}/{remote}", dest)
        except Exception as e:  # noqa: BLE001
            print(f"  HATA: {local} indirilemedi: {e}", file=sys.stderr, flush=True)
            missing += 1
            continue
        actual = os.path.getsize(dest)
        if size is not None and actual != size:
            print(f"  HATA: {local} boyutu tutmuyor ({actual} != {size})", file=sys.stderr, flush=True)
            missing += 1

    if missing:
        print(f"{missing} dosya eksik/hatalı.", file=sys.stderr)
        return 1

    # Bütünlük: model.pt SHA-256 özetini yaz (kayıt için)
    model = os.path.join(MODEL_DIR, "model.pt")
    h = hashlib.sha256()
    with open(model, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    print(f"Tamam. model.pt sha256={h.hexdigest()}", flush=True)
    print(f"Model dizini: {MODEL_DIR}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
