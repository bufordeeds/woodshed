"""Stem separation with Demucs (htdemucs): drums / bass / other / vocals."""
from __future__ import annotations

import hashlib
import logging
import os
import urllib.request
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

MODEL_NAME = "htdemucs"
# Official checkpoint for htdemucs; the filename carries the first 8 hex chars of its sha256.
_CKPT_NAME = "955717e8-8726e21a.th"
_CKPT_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
_OFFICIAL_URL = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/" + _CKPT_NAME
# Byte-identical copy (same sha256), used only if the official host is unreachable.
_MIRROR_URL = os.environ.get(
    "WOODSHED_DEMUCS_MIRROR",
    "https://huggingface.co/anchor-flux/demucs-htdemucs/resolve/main/htdemucs.th",
)

_model = None


def _ensure_weights() -> None:
    """Make sure the checkpoint is in the torch hub cache, falling back to a mirror.

    Demucs itself only knows the official URL. The file is verified against the
    known sha256 whichever host it came from.
    """
    import torch

    ckpt = Path(torch.hub.get_dir()) / "checkpoints" / _CKPT_NAME
    if ckpt.exists():
        return
    ckpt.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    for url in (_OFFICIAL_URL, _MIRROR_URL):
        if not url:
            continue
        tmp = ckpt.with_suffix(".part")
        try:
            log.info("Downloading Demucs weights from %s", url)
            h = hashlib.sha256()
            with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
                    h.update(chunk)
            if h.hexdigest() != _CKPT_SHA256:
                raise RuntimeError(f"checksum mismatch ({h.hexdigest()[:12]}…)")
            tmp.replace(ckpt)
            return
        except Exception as e:  # noqa: BLE001 - try next host
            errors.append(f"{url}: {e}")
            tmp.unlink(missing_ok=True)
    raise RuntimeError("Could not download Demucs htdemucs weights. " + " | ".join(errors))


def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model

        _ensure_weights()
        _model = get_model(MODEL_NAME)
        _model.eval()
    return _model


STEMS = ["drums", "bass", "other", "vocals"]


def separate(audio: np.ndarray, sr: int = 44100, *, shifts: int = 0, overlap: float = 0.25) -> dict[str, np.ndarray]:
    """Split 44.1 kHz stereo audio (2, n) into {drums, bass, other, vocals}, each (2, n).

    Tries the GPU (Apple MPS / CUDA) first and quietly falls back to CPU if that fails.
    """
    import torch
    from demucs.apply import apply_model

    from .device import pick_device

    model = _get_model()
    if sr != model.samplerate:
        raise ValueError(f"Demucs expects {model.samplerate} Hz audio, got {sr}")
    wav = torch.from_numpy(np.ascontiguousarray(audio)).float()
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = ((wav - mean) / std)[None]
    device = pick_device()
    out = None
    if device != "cpu":
        try:
            with torch.no_grad():
                out = apply_model(model, x, device=device, shifts=shifts, split=True, overlap=overlap, progress=False)[0]
            out = out.cpu()
        except Exception as e:  # noqa: BLE001 - e.g. an op MPS does not support
            log.warning("Demucs on %s failed (%s); falling back to CPU", device, e)
            model.cpu()
            out = None
    if out is None:
        with torch.no_grad():
            out = apply_model(model, x, device="cpu", shifts=shifts, split=True, overlap=overlap, progress=False)[0]
    out = out * std + mean
    return {name: out[model.sources.index(name)].numpy().astype(np.float32) for name in STEMS}
