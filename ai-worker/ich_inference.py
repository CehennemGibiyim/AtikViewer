from __future__ import annotations

import copy
from pathlib import Path

import cv2
import numpy as np
import torch
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file

from skp.configs import Config
from skp.configs.defaults import classification_2d_defaults, segmentation_2d_defaults
from skp.models.classification.net2d import Net as Classifier
from skp.models.classification.ich_sequence import Net as SequenceModel
from skp.models.segmentation.base import Net as Segmenter


MODEL_REPO = "ianpan/ct-head-hemorrhage-detection"
CLASS_NAMES = [
    "epidural",
    "intraparenchymal",
    "intraventricular",
    "subarachnoid",
    "subdural",
    "any",
]
WINDOW_CENTERS = np.asarray([40.0, 80.0, 600.0], dtype=np.float32)
WINDOW_WIDTHS = np.asarray([80.0, 200.0, 2800.0], dtype=np.float32)
LARGE_IMAGE_RESIZE_THRESHOLD = 640
MAX_SEQUENCE_LENGTH = 64
SLICE_BLEND_ALPHAS = torch.tensor(
    [0.75, 0.75, 0.75, 0.75, 0.75, 1.0], dtype=torch.float32
)
SERIES_BLEND_ALPHAS = torch.tensor(
    [0.5, 0.25, 0.5, 1.0, 0.5, 0.5], dtype=torch.float32
)


def _classifier_config() -> Config:
    cfg = Config()
    classification_2d_defaults(cfg)
    cfg.backbone = "maxvit_tiny_tf_512.in1k"
    cfg.pretrained = False
    cfg.num_input_channels = 9
    cfg.num_classes = 6
    cfg.pool = "avg"
    cfg.dropout = 0.2
    cfg.normalization = "linear"
    cfg.normalization_params = {
        "input_min": 0.0,
        "input_max": 1.0,
        "output_min": -1.0,
        "output_max": 1.0,
    }
    cfg.backbone_img_size = False
    cfg.image_height = 512
    cfg.image_width = 512
    return cfg


def _segmenter_config() -> Config:
    cfg = Config()
    segmentation_2d_defaults(cfg)
    cfg.backbone = "maxvit_tiny_tf_512.in1k"
    cfg.pretrained = False
    cfg.num_input_channels = 9
    cfg.num_classes = 6
    cfg.normalization = "linear"
    cfg.normalization_params = {
        "input_min": 0.0,
        "input_max": 1.0,
        "output_min": -1.0,
        "output_max": 1.0,
    }
    cfg.backbone_img_size = False
    cfg.image_height = 512
    cfg.image_width = 512
    cfg.decoder_type = "DeepLabV3PlusDecoder"
    cfg.decoder_out_channels = 256
    cfg.decoder_norm_layer = "bn"
    cfg.decoder_act_layer = "relu"
    cfg.decoder_attention_type = None
    cfg.decoder_center_block = False
    cfg.aspp_separable = True
    cfg.aspp_dropout = 0.1
    cfg.atrous_rates = (6, 12, 18, 24)
    cfg.seg_dropout = 0.0
    return cfg


def _sequence_config() -> Config:
    cfg = Config()
    cfg.feature_dim = 512
    cfg.num_classes = 6
    cfg.sequence_projection_dim = 512
    cfg.sequence_hidden_dim = 256
    cfg.sequence_num_layers = 2
    cfg.sequence_dropout = 0.2
    cfg.sequence_architecture = "gru"
    cfg.attention_dim = 128
    cfg.dropout = 0.2
    cfg.feature_noise_std = 0.02
    cfg.feature_dropout = 0.05
    cfg.slice_feature_dropout = 0.02
    return cfg


def center_crop_or_pad(image: np.ndarray, size: int = 512) -> np.ndarray:
    if image.ndim != 2:
        raise ValueError(f"Expected a 2D image, got shape {image.shape}.")
    height, width = image.shape
    if height > LARGE_IMAGE_RESIZE_THRESHOLD or width > LARGE_IMAGE_RESIZE_THRESHOLD:
        return cv2.resize(
            image.astype(np.float32),
            (size, size),
            interpolation=cv2.INTER_AREA,
        )
    top = max((height - size) // 2, 0)
    left = max((width - size) // 2, 0)
    image = image[top : top + size, left : left + size]
    pad_height = size - image.shape[0]
    pad_width = size - image.shape[1]
    return np.pad(
        image,
        (
            (pad_height // 2, pad_height - pad_height // 2),
            (pad_width // 2, pad_width - pad_width // 2),
        ),
        mode="constant",
        constant_values=0,
    )


def read_uint16_png(path: str | Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise FileNotFoundError(path)
    if image.dtype != np.uint16:
        raise ValueError(f"Expected uint16 PNG, got {image.dtype}: {path}")
    return center_crop_or_pad(image)


def window_slice(
    image: np.ndarray | None,
    *,
    rescale_slope: float,
    rescale_intercept: float,
) -> np.ndarray:
    if image is None:
        return np.zeros((3, 512, 512), dtype=np.float32)
    if not np.isfinite([rescale_slope, rescale_intercept]).all():
        raise ValueError("Rescale slope and intercept must be finite.")
    hu = image.astype(np.float32) * float(rescale_slope) + float(rescale_intercept)
    lower = WINDOW_CENTERS - WINDOW_WIDTHS / 2
    upper = WINDOW_CENTERS + WINDOW_WIDTHS / 2
    x = np.clip(hu[None], lower[:, None, None], upper[:, None, None])
    return (x - lower[:, None, None]) / (WINDOW_WIDTHS[:, None, None] + 1e-6)


def window_hu_slice(image: np.ndarray | None) -> np.ndarray:
    """Window one HU slice, or return a zero-valued boundary neighbor."""
    if image is None:
        return np.zeros((3, 512, 512), dtype=np.float32)
    image = np.asarray(image, dtype=np.float32)
    if image.ndim != 2:
        raise ValueError(f"Expected a 2D HU image, got shape {image.shape}.")
    if not np.isfinite(image).all():
        raise ValueError("HU image contains non-finite values.")
    height, width = image.shape
    if height > LARGE_IMAGE_RESIZE_THRESHOLD or width > LARGE_IMAGE_RESIZE_THRESHOLD:
        image = cv2.resize(
            image,
            (512, 512),
            interpolation=cv2.INTER_AREA,
        )
        height, width = image.shape
    top = max((height - 512) // 2, 0)
    left = max((width - 512) // 2, 0)
    image = image[top : top + 512, left : left + 512]
    lower = WINDOW_CENTERS - WINDOW_WIDTHS / 2
    upper = WINDOW_CENTERS + WINDOW_WIDTHS / 2
    x = np.clip(image[None], lower[:, None, None], upper[:, None, None])
    x = (x - lower[:, None, None]) / (WINDOW_WIDTHS[:, None, None] + 1e-6)
    pad_height = 512 - x.shape[1]
    pad_width = 512 - x.shape[2]
    return np.pad(
        x,
        (
            (0, 0),
            (pad_height // 2, pad_height - pad_height // 2),
            (pad_width // 2, pad_width - pad_width // 2),
        ),
        mode="constant",
        constant_values=0,
    )


def preprocess_slab(
    previous: np.ndarray | None,
    center: np.ndarray,
    next_slice: np.ndarray | None,
    *,
    rescale_slope: float,
    rescale_intercept: float,
) -> np.ndarray:
    slices = [previous, center, next_slice]
    slices = [
        center_crop_or_pad(image) if image is not None else None for image in slices
    ]
    windowed = np.stack(
        [
            window_slice(
                image,
                rescale_slope=rescale_slope,
                rescale_intercept=rescale_intercept,
            )
            for image in slices
        ],
        axis=0,
    )
    return np.ascontiguousarray(windowed.reshape(9, 512, 512))


def preprocess_hu_volume_slab(volume: np.ndarray, center_index: int) -> np.ndarray:
    """Create a 9-channel slab from a physically ordered ``(D, H, W)`` HU volume."""
    volume = np.asarray(volume)
    if volume.ndim != 3:
        raise ValueError(f"Expected a (D, H, W) volume, got shape {volume.shape}.")
    if not 0 <= center_index < len(volume):
        raise IndexError(
            f"center_index {center_index} is outside volume depth {len(volume)}."
        )
    indices = [center_index - 1, center_index, center_index + 1]
    slices = [volume[index] if 0 <= index < len(volume) else None for index in indices]
    windowed = np.stack([window_hu_slice(image) for image in slices], axis=0)
    return np.ascontiguousarray(windowed.reshape(9, 512, 512))


def read_dicom_series(
    folder_path: str | Path,
    *,
    backend: str = "pydicom",
    max_workers: int | None = None,
) -> dict:
    """Read and physically sort a single-frame CT series into an HU volume."""
    from skp.toolbox.dicom import load_dicom_series

    series = load_dicom_series(
        str(folder_path),
        backend=backend,
        sort_by_instance=False,
        rescale_pixel_values=True,
        require_rescale_values=True,
        fix_unequal_shapes_method="crop_pad",
        max_workers=max_workers,
        orientation=None,
    )
    if str(series["modality"]).upper() != "CT":
        raise ValueError(
            f"Expected a CT DICOM series, got modality {series['modality']!r}."
        )
    return series


def read_nifti_volume(path: str | Path) -> np.ndarray:
    """Read an HU NIfTI and return DICOM-like ``(D, H, W)`` LPS orientation.

    Header scaling is applied through nibabel's array proxy. Voxel axes are
    permuted/flipped to LPS, then transposed to depth/row/column order. This is
    nearest-axis reorientation, not interpolation of an arbitrarily oblique
    acquisition.
    """
    try:
        import nibabel as nib
    except ModuleNotFoundError as error:
        raise ModuleNotFoundError(
            "nibabel is required for NIfTI loading; install requirements.txt."
        ) from error

    image = nib.load(str(path))
    if len(image.shape) != 3:
        raise ValueError(f"Expected a 3D NIfTI, got shape {image.shape}: {path}")
    source_orientation = nib.orientations.io_orientation(image.affine)
    if np.isnan(source_orientation).any():
        raise ValueError(f"Could not determine NIfTI orientation from affine: {path}")
    target_orientation = nib.orientations.axcodes2ornt(("L", "P", "S"))
    transform = nib.orientations.ornt_transform(
        source_orientation,
        target_orientation,
    )
    data = np.asanyarray(image.dataobj, dtype=np.float32)
    lps = nib.orientations.apply_orientation(data, transform)
    volume = lps.transpose(2, 1, 0)
    if not np.isfinite(volume).all():
        raise ValueError(f"NIfTI contains non-finite values: {path}")
    return np.ascontiguousarray(volume, dtype=np.float32)


class HemorrhageSliceModel:
    """One shared encoder with classifier and five localization decoders."""

    def __init__(
        self,
        repo_id: str = MODEL_REPO,
        *,
        revision: str | None = None,
        device: str | torch.device | None = None,
        local_dir: str | Path | None = None,
    ) -> None:
        self.repo_id = repo_id
        self.revision = revision
        self.local_dir = Path(local_dir) if local_dir is not None else None
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )

        classifier_state = load_file(
            self._artifact("classifier/model.safetensors"),
            device="cpu",
        )
        classifier = Classifier(_classifier_config())
        classifier.load_state_dict(classifier_state, strict=True)
        classifier.eval()

        segmenter = Segmenter(_segmenter_config())
        segmenter_state = segmenter.state_dict()
        shared_encoder = {}
        for key, value in classifier_state.items():
            if not key.startswith("backbone.") or key.startswith("backbone.head."):
                continue
            encoder_key = key.removeprefix("backbone.")
            if encoder_key.startswith("stages."):
                encoder_key = "stages_" + encoder_key.removeprefix("stages.")
            segmenter_key = "encoder." + encoder_key
            if segmenter_key in segmenter_state:
                shared_encoder[segmenter_key] = value
        expected_encoder_keys = {
            f"encoder.{key}" for key in segmenter.encoder.state_dict()
        }
        if set(shared_encoder) != expected_encoder_keys:
            missing = sorted(expected_encoder_keys - set(shared_encoder))
            raise RuntimeError(f"Missing shared encoder keys: {missing[:5]}")
        result = segmenter.load_state_dict(shared_encoder, strict=False)
        if result.unexpected_keys:
            raise RuntimeError(f"Unexpected encoder keys: {result.unexpected_keys}")

        self.encoder = segmenter.encoder.eval().to(self.device)
        self.classifier_head = classifier.backbone.head.eval().to(self.device)
        self.classifier_pooling = classifier.pooling.eval().to(self.device)
        self.classifier_linear = classifier.linear.eval().to(self.device)

        self.sequence_model = SequenceModel(_sequence_config())
        self.sequence_model.load_state_dict(
            load_file(self._artifact("sequence/model.safetensors"), device="cpu"),
            strict=True,
        )
        self.sequence_model.eval().to(self.device)

        self.segmentation_decoders = []
        self.segmentation_heads = []
        for fold in range(5):
            fold_state = load_file(
                self._artifact(f"segmentation/fold{fold}.safetensors"),
                device="cpu",
            )
            decoder_state = {
                key.removeprefix("decoder."): value
                for key, value in fold_state.items()
                if key.startswith("decoder.")
            }
            head_state = {
                key.removeprefix("segmentation_head."): value
                for key, value in fold_state.items()
                if key.startswith("segmentation_head.")
            }
            decoder = copy.deepcopy(segmenter.decoder)
            head = copy.deepcopy(segmenter.segmentation_head)
            decoder.load_state_dict(decoder_state, strict=True)
            head.load_state_dict(head_state, strict=True)
            self.segmentation_decoders.append(decoder.eval().to(self.device))
            self.segmentation_heads.append(head.eval().to(self.device))

    def _artifact(self, filename: str) -> str:
        if self.local_dir is not None:
            return str(self.local_dir / filename)
        return hf_hub_download(
            repo_id=self.repo_id,
            filename=filename,
            revision=self.revision,
        )

    @staticmethod
    def _validate_windowed_input(x: np.ndarray) -> None:
        if not np.isfinite(x).all():
            raise ValueError("Model input contains non-finite values.")
        minimum = float(x.min())
        maximum = float(x.max())
        if minimum < 0.0 or maximum > 1.0:
            raise ValueError(
                "Model input must contain CT windows scaled to [0, 1]; "
                f"observed range [{minimum}, {maximum}]."
            )

    @staticmethod
    def _resample_indices(length: int) -> np.ndarray:
        if length <= MAX_SEQUENCE_LENGTH:
            return np.arange(length, dtype=np.int64)
        return np.rint(np.linspace(0, length - 1, MAX_SEQUENCE_LENGTH)).astype(np.int64)

    @staticmethod
    def _restore_predictions(
        predictions: torch.Tensor,
        sampled_indices: np.ndarray,
        original_length: int,
    ) -> torch.Tensor:
        original_indices = np.arange(original_length, dtype=np.int64)
        right = np.searchsorted(sampled_indices, original_indices, side="left")
        right = np.clip(right, 0, len(sampled_indices) - 1)
        left = np.clip(right - 1, 0, len(sampled_indices) - 1)
        choose_left = np.abs(original_indices - sampled_indices[left]) <= np.abs(
            sampled_indices[right] - original_indices
        )
        nearest = np.where(choose_left, left, right)
        return predictions[torch.from_numpy(nearest).to(predictions.device)]

    def _encode_batch(
        self,
        tensor: torch.Tensor,
        *,
        return_segmentation: bool,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor | None]:
        autocast = {
            "device_type": self.device.type,
            "dtype": torch.bfloat16,
            "enabled": self.device.type == "cuda",
        }
        with torch.autocast(**autocast):
            feature_maps = self.encoder(tensor * 2.0 - 1.0)
            classifier_map = self.classifier_head(feature_maps[-1], pre_logits=True)
            pooled_features = self.classifier_pooling(classifier_map)
            base_logits = self.classifier_linear(pooled_features)

        segmentation = None
        if return_segmentation:
            fold_masks = []
            for decoder, head in zip(
                self.segmentation_decoders,
                self.segmentation_heads,
            ):
                with torch.autocast(**autocast):
                    fold_logits = head(decoder(feature_maps)[-1])
                fold_masks.append(fold_logits.float().sigmoid())
            segmentation = torch.stack(fold_masks).mean(0)
        return pooled_features.float(), base_logits.float(), segmentation

    @torch.inference_mode()
    def predict(self, x: np.ndarray) -> dict[str, np.ndarray]:
        if x.shape != (9, 512, 512):
            raise ValueError(f"Expected input shape (9, 512, 512), got {x.shape}.")
        self._validate_windowed_input(x)
        tensor = torch.from_numpy(x[None]).float().to(self.device)
        _, logits, segmentation = self._encode_batch(
            tensor,
            return_segmentation=True,
        )
        return {
            "classification": logits.sigmoid().cpu().numpy()[0],
            "segmentation": segmentation.cpu().numpy()[0],
        }

    @torch.inference_mode()
    def predict_series(
        self,
        slabs: np.ndarray,
        *,
        batch_size: int = 4,
        return_segmentation: bool = True,
        long_series_mode: str = "resample",
    ) -> dict[str, np.ndarray | str]:
        """Run one ordered CT series through the shared integrated model.

        Each slab is encoded exactly once. The same feature pyramid is consumed
        by all five segmentation decoders, while the same pooled 512-D feature
        is consumed by both the linear classifier and the BiGRU.
        """
        slabs = np.asarray(slabs, dtype=np.float32)
        if slabs.ndim != 4 or slabs.shape[1:] != (9, 512, 512):
            raise ValueError(
                f"Expected slabs with shape (N, 9, 512, 512), got {slabs.shape}."
            )
        if len(slabs) == 0:
            raise ValueError("At least one slab is required.")
        if batch_size <= 0:
            raise ValueError("batch_size must be positive.")
        self._validate_windowed_input(slabs)

        pooled_batches = []
        base_logit_batches = []
        segmentation_batches = []
        for start in range(0, len(slabs), batch_size):
            tensor = torch.from_numpy(slabs[start : start + batch_size]).to(self.device)
            pooled, base_logits, segmentation = self._encode_batch(
                tensor,
                return_segmentation=return_segmentation,
            )
            pooled_batches.append(pooled)
            base_logit_batches.append(base_logits)
            if segmentation is not None:
                segmentation_batches.append(segmentation.cpu())

        return self._predict_from_encoded_series(
            torch.cat(pooled_batches),
            torch.cat(base_logit_batches),
            segmentation_batches,
            long_series_mode=long_series_mode,
        )

    @torch.inference_mode()
    def predict_hu_volume(
        self,
        volume: np.ndarray,
        *,
        batch_size: int = 4,
        return_segmentation: bool = True,
        long_series_mode: str = "resample",
    ) -> dict[str, np.ndarray | str]:
        """Preprocess and predict a physically ordered ``(D, H, W)`` HU volume.

        Only one batch of 9-channel slabs is materialized at a time, limiting
        both host and accelerator memory. Every center slice is still encoded
        exactly once.
        """
        volume = np.asarray(volume)
        if volume.ndim != 3 or len(volume) == 0:
            raise ValueError(
                f"Expected a non-empty (D, H, W) HU volume, got {volume.shape}."
            )
        if not np.isfinite(volume).all():
            raise ValueError("HU volume contains non-finite values.")
        if batch_size <= 0:
            raise ValueError("batch_size must be positive.")

        pooled_batches = []
        base_logit_batches = []
        segmentation_batches = []
        for start in range(0, len(volume), batch_size):
            stop = min(start + batch_size, len(volume))
            slabs = np.stack(
                [
                    preprocess_hu_volume_slab(volume, index)
                    for index in range(start, stop)
                ]
            )
            tensor = torch.from_numpy(slabs).to(self.device)
            pooled, base_logits, segmentation = self._encode_batch(
                tensor,
                return_segmentation=return_segmentation,
            )
            pooled_batches.append(pooled)
            base_logit_batches.append(base_logits)
            if segmentation is not None:
                segmentation_batches.append(segmentation.cpu())

        return self._predict_from_encoded_series(
            torch.cat(pooled_batches),
            torch.cat(base_logit_batches),
            segmentation_batches,
            long_series_mode=long_series_mode,
        )

    @torch.inference_mode()
    def _predict_from_encoded_series(
        self,
        pooled_features: torch.Tensor,
        base_slice_logits: torch.Tensor,
        segmentation_batches: list[torch.Tensor],
        *,
        long_series_mode: str,
    ) -> dict[str, np.ndarray | str]:
        original_length = len(pooled_features)
        if long_series_mode == "full":
            sampled = np.arange(original_length, dtype=np.int64)
        elif long_series_mode == "resample":
            sampled = self._resample_indices(original_length)
        else:
            raise ValueError("long_series_mode must be 'full' or 'resample'.")
        sampled_tensor = torch.from_numpy(sampled).to(self.device)
        sequence_length = len(sampled)
        position = sampled_tensor.float() / max(original_length - 1, 1)
        sequence_batch = {
            "x": pooled_features[sampled_tensor].unsqueeze(0),
            "position": position.unsqueeze(0),
            "valid_mask": torch.ones(
                (1, sequence_length), dtype=torch.bool, device=self.device
            ),
            "length": torch.tensor(
                [sequence_length], dtype=torch.long, device=self.device
            ),
        }
        autocast = {
            "device_type": self.device.type,
            "dtype": torch.bfloat16,
            "enabled": self.device.type == "cuda",
        }
        with torch.autocast(**autocast):
            sequence_output = self.sequence_model(sequence_batch)
        contextual_sampled_logits = sequence_output["slice_logits"][0].float()
        contextual_slice_logits = self._restore_predictions(
            contextual_sampled_logits,
            sampled,
            original_length,
        )

        slice_alpha = SLICE_BLEND_ALPHAS.to(self.device)
        blended_slice_logits = (
            1.0 - slice_alpha
        ) * base_slice_logits + slice_alpha * contextual_slice_logits
        base_series_probability = (
            base_slice_logits.sigmoid().amax(0).clamp(1e-6, 1 - 1e-6)
        )
        base_series_logits = torch.logit(base_series_probability)
        contextual_series_logits = sequence_output["series_logits"][0].float()
        series_alpha = SERIES_BLEND_ALPHAS.to(self.device)
        blended_series_logits = (
            1.0 - series_alpha
        ) * base_series_logits + series_alpha * contextual_series_logits

        output = {
            "pooled_features": pooled_features.cpu().numpy(),
            "base_slice_classification": base_slice_logits.sigmoid().cpu().numpy(),
            "contextual_slice_classification": (
                contextual_slice_logits.sigmoid().cpu().numpy()
            ),
            "slice_classification": blended_slice_logits.sigmoid().cpu().numpy(),
            "base_series_classification": base_series_probability.cpu().numpy(),
            "contextual_series_classification": (
                contextual_series_logits.sigmoid().cpu().numpy()
            ),
            "series_classification": blended_series_logits.sigmoid().cpu().numpy(),
            "mil_series_classification": (
                sequence_output["mil_logits"][0].float().sigmoid().cpu().numpy()
            ),
            "sequence_attention": (
                sequence_output["sequence_attention"][0].float().cpu().numpy()
            ),
            "mil_attention": (
                sequence_output["mil_attention"][0].float().cpu().numpy()
            ),
            "sampled_indices": sampled,
            "long_series_mode": long_series_mode,
        }
        if segmentation_batches:
            output["segmentation"] = torch.cat(segmentation_batches).numpy()
        return output
