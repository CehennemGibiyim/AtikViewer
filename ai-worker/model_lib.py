"""MONAI lung_nodule_ct_detection bundle modelini yükleyen ortak kütüphane.

Bundle: https://huggingface.co/MONAI/lung_nodule_ct_detection (Apache-2.0)
Eğitim: LUNA16 akciğer nodülü tespiti (RetinaNet + ResNet50-3D FPN).

Ön işleme (configs/inference.json ile birebir):
  - HU klibi: [-1024, 300] -> [0, 1]   (ScaleIntensityRanged, clip=True)
  - Boşluk (spacing): (0.703125, 0.703125, 1.25) mm   (x, y, z)
  - Yönlendirme: RAS  (DICOM LPS girdisi x/y ekseni çevrilerek RAS'a çevrilir)

Girdi tensor düzeni [C, X, Y, Z] (MONAI/NIfTI düzeni). Kutular model uzayında
xyzxyz (iki köşe) olarak döner; server.py orijinal kesit koordinatına çevirir.
"""

import os
import sys

import numpy as np
import torch
import torch.nn.functional as F

MODEL_DIR = os.environ.get(
    "ATIK_MODEL_DIR",
    os.path.join(os.path.expanduser("~"), ".cache", "atikviewer-ai", "model"),
)
MODEL_PATH = os.path.join(MODEL_DIR, "model.pt")

# GPU (CUDA) varsa kullan; yoksa CPU. ATIK_FORCE_CPU=1 ile CPU'ya zorlanır.
DEVICE = torch.device(
    "cpu"
    if os.environ.get("ATIK_FORCE_CPU") == "1" or not torch.cuda.is_available()
    else "cuda"
)

# Bundle configs/inference.json değerleri
PIXDIM = (0.703125, 0.703125, 1.25)  # (x, y, z) mm
HU_MIN, HU_MAX = -1024.0, 300.0
SCORE_THRESH = float(os.environ.get("ATIK_SCORE_THRESH", "0.30"))
NMS_THRESH = 0.22
DETECTIONS = 100
# Kayan pencere boyutu (x, y, z) voxel. Bundle varsayılanı [512,512,192] CPU'da
# belleği aşar; eğitilmiş ağ aynı kalır, yalnızca pencere küçültülür (overlap 0.25).
ROI_SIZE = tuple(int(v) for v in os.environ.get("ATIK_ROI", "256,256,96").split(","))

_state = {"net": None, "inferer": None, "lock": None}


def _build():
    from monai.networks.nets.resnet import resnet50
    from monai.apps.detection.networks.retinanet_network import (
        resnet_fpn_feature_extractor,
        RetinaNet,
    )
    from monai.apps.detection.networks.retinanet_detector import RetinaNetDetector
    from monai.apps.detection.utils.anchor_utils import AnchorGeneratorWithAnchorShape

    if MODEL_DIR not in sys.path:
        sys.path.insert(0, MODEL_DIR)
    from scripts.detection_inferer import RetinaNetInferer  # bundle scripts

    backbone = resnet50(
        spatial_dims=3,
        n_input_channels=1,
        conv1_t_stride=[2, 2, 1],
        conv1_t_size=[7, 7, 7],
    )
    feature_extractor = resnet_fpn_feature_extractor(backbone, 3, False, [1, 2], None)
    network = RetinaNet(
        spatial_dims=3,
        num_classes=1,
        num_anchors=3,
        feature_extractor=feature_extractor,
        size_divisible=[16, 16, 8],
        use_list_output=False,
    )
    sd = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
    missing, unexpected = network.load_state_dict(sd, strict=False)
    if missing or unexpected:
        raise RuntimeError(
            f"Checkpoint uyumsuz: eksik={len(missing)} fazla={len(unexpected)} "
            f"örnek={list(missing)[:3]} / {list(unexpected)[:3]}"
        )
    network.to(DEVICE)
    network.eval()

    anchor_generator = AnchorGeneratorWithAnchorShape(
        feature_map_scales=[1, 2, 4],
        base_anchor_shapes=[[6, 8, 4], [8, 6, 5], [10, 10, 6]],
    )
    detector = RetinaNetDetector(
        network=network,
        anchor_generator=anchor_generator,
        debug=False,
        spatial_dims=3,
        num_classes=1,
        size_divisible=[16, 16, 8],
    )
    detector.set_target_keys(box_key="box", label_key="label")
    detector.set_box_selector_parameters(
        score_thresh=SCORE_THRESH,
        topk_candidates_per_level=1000,
        nms_thresh=NMS_THRESH,
        detections_per_img=DETECTIONS,
    )
    detector.set_sliding_window_inferer(
        roi_size=list(ROI_SIZE),
        overlap=0.25,
        sw_batch_size=1,
        mode="constant",
        device=str(DEVICE),
    )
    inferer = RetinaNetInferer(detector, force_sliding_window=False)
    return network, inferer


def get_inferer():
    if _state["inferer"] is None:
        import threading

        if _state["lock"] is None:
            _state["lock"] = threading.Lock()
        with _state["lock"]:
            if _state["inferer"] is None:
                _state["net"], _state["inferer"] = _build()
    return _state["inferer"], _state["net"]


def model_ready() -> bool:
    return os.path.isfile(MODEL_PATH)


def resample_to_luna16(hu_zyx: np.ndarray, spacing_zyx) -> np.ndarray:
    """(Z,Y,X) HU hacmini model boşluğuna (0.703,0.703,1.25) mm yeniden örnekler.

    Girdi: hu_zyx float32 (Z,Y,X), spacing_zyx (sz,sy,sx) mm.
    Çıktı: float32 (X',Y',Z') — model düzeni [X,Y,Z].
    """
    sx, sy, sz = float(spacing_zyx[1]), float(spacing_zyx[0]), float(spacing_zyx[2])
    # (Z,Y,X) -> (X,Y,Z)
    b = np.transpose(hu_zyx.astype(np.float32), (2, 1, 0))
    # LPS -> RAS: x ve y ekseni çevrilir (standital aksiyel DICOM varsayımı)
    b = np.ascontiguousarray(b[::-1, ::-1, :])
    nx = max(1, int(round(b.shape[0] * sx / PIXDIM[0])))
    ny = max(1, int(round(b.shape[1] * sy / PIXDIM[1])))
    nz = max(1, int(round(b.shape[2] * sz / PIXDIM[2])))
    t = torch.from_numpy(b).unsqueeze(0).unsqueeze(0)  # [1,1,X,Y,Z]
    out = F.interpolate(t, size=(nx, ny, nz), mode="trilinear", align_corners=False)
    return out.squeeze(0).squeeze(0).numpy()


def to_model_input(resampled_xyz: np.ndarray) -> torch.Tensor:
    """Model girdisine çevirir: HU klibi + ölçekleme, [1,1,X,Y,Z]."""
    x = np.clip(resampled_xyz, HU_MIN, HU_MAX)
    x = (x - HU_MIN) / (HU_MAX - HU_MIN)
    return torch.from_numpy(np.ascontiguousarray(x)).unsqueeze(0).unsqueeze(0)


def run_inference(resampled_xyz: np.ndarray):
    """Model çıkarımı.

    Returns: (boxes xyzxyz numpy [N,6] resampled-uzayda, scores [N])
    """
    inferer, net = get_inferer()
    inp = to_model_input(resampled_xyz).to(DEVICE)  # [1,1,X,Y,Z]
    with torch.inference_mode():
        pred = inferer([inp[0]], net)  # List[Tensor]; her eleman [C,X,Y,Z]
    if isinstance(pred, (list, tuple)):
        pred = pred[0]
    boxes = pred["box"]
    scores = pred.get("label_scores", pred.get("scores"))
    if isinstance(boxes, (list, tuple)):
        boxes = boxes[0]
        scores = scores[0]
    return boxes.detach().cpu().numpy(), scores.detach().cpu().numpy()
