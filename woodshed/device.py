"""Pick where the heavy model (Demucs) runs: Apple GPU, NVIDIA GPU or CPU."""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def pick_device() -> str:
    """WOODSHED_DEVICE=cpu|mps|cuda overrides; default is the fastest thing available."""
    want = os.environ.get("WOODSHED_DEVICE", "auto").lower()
    import torch

    has = {"cuda": torch.cuda.is_available(),
           "mps": bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available(),
           "cpu": True}
    if want in has:
        if has[want]:
            return want
        log.warning("WOODSHED_DEVICE=%s is not available here, using CPU", want)
        return "cpu"
    return "cuda" if has["cuda"] else "mps" if has["mps"] else "cpu"
