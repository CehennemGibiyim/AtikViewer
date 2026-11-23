"""MONAI lung_nodule_ct_detection bundle dosyalarını indirir (ücretsiz, Apache-2.0).

Kullanım:
    python ai-worker/setup_model.py

İkinci modeli de indirir: BT beyin ICH (ianpan/ct-head-hemorrhage-detection, MIT,
≈147 MB) → ~/.cache/atikviewer-ai/brain (ai-worker/brain_lib için zorunlu).

Akciğer dosyaları ATIK_MODEL_DIR (varsayılan ~/.cache/atikviewer-ai/model) altına iner:
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

# Windows konsolları varsayılan olarak UTF-8 değil; Türkçe çıktı bozulmasın.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # noqa: BLE001
        pass

BASE = "https://huggingface.co/MONAI/lung_nodule_ct_detection/resolve/main"
MODEL_DIR = os.environ.get(
    "ATIK_MODEL_DIR",
    os.path.join(os.path.expanduser("~"), ".cache", "atikviewer-ai", "model"),
)

# ── İkinci model: BT beyin ICH (ianpan/ct-head-hemorrhage-detection, MIT) ──
# Yol brain_lib.CACHE_DIR ile birebir aynı olmalıdır; dosya listesi ve boyutları
# HuggingFace deposundaki LFS boyutlarıyla doğrulanmıştır (7 dosya, ≈147 MB).
BRAIN_REPO = "ianpan/ct-head-hemorrhage-detection"
BRAIN_DIR = os.path.join(os.path.expanduser("~"), ".cache", "atikviewer-ai", "brain")
BRAIN_FILES = [
    ("classifier/model.safetensors", 122_429_448),
    ("sequence/model.safetensors", 11_098_536),
    ("segmentation/fold0.safetensors", 5_498_088),
    ("segmentation/fold1.safetensors", 5_498_088),
    ("segmentation/fold2.safetensors", 5_498_088),
    ("segmentation/fold3.safetensors", 5_498_088),
    ("segmentation/fold4.safetensors", 5_498_088),
]

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


def setup_brain() -> int:
    """BT beyin ICH ağırlıklarını indirir (idempotent).

    Mevcut ve boyutu doğrulanmış dosyalar atlanır; hatalı boyutlu dosya önce
    silinir. huggingface_hub gereklidir (requirements.txt) — yalnızca indirme
    anında import edilir ki akciğer paketi tek başına da çalışabilsin.
    Eksik/hatalı dosya sayısını döndürür (0 = tamam).
    """
    os.makedirs(BRAIN_DIR, exist_ok=True)
    missing = 0
    for remote, size in BRAIN_FILES:
        dest = os.path.join(BRAIN_DIR, *remote.split("/"))
        if os.path.isfile(dest):
            actual = os.path.getsize(dest)
            if actual == size:
                print(f"  atlandı (mevcut): {remote} ({actual} bayt)", flush=True)
                continue
            print(f"  boyut uyuşmuyor ({actual} != {size}), yeniden indiriliyor: {remote}", flush=True)
            try:
                os.remove(dest)
            except OSError:
                pass
        try:
            from huggingface_hub import hf_hub_download

            hf_hub_download(repo_id=BRAIN_REPO, filename=remote, local_dir=BRAIN_DIR)
        except Exception as e:  # noqa: BLE001
            print(f"  HATA: {remote} indirilemedi: {e}", file=sys.stderr, flush=True)
            missing += 1
            continue
        if not os.path.isfile(dest) or os.path.getsize(dest) != size:
            print(f"  HATA: {remote} boyutu tutmuyor", file=sys.stderr, flush=True)
            missing += 1

    if missing:
        print(f"Beyin modeli: {missing} dosya eksik/hatalı.", file=sys.stderr, flush=True)
    else:
        print(f"Beyin modeli hazır: {BRAIN_DIR}", flush=True)
    return missing


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

    # İkinci model: BT beyin ICH ağırlıkları (ai-worker/brain_lib kullanır)
    return 1 if setup_brain() else 0


if __name__ == "__main__":
    raise SystemExit(main())
