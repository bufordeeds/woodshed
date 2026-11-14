"""Drum hit detection with ADTOF (Frame_RNN, PyTorch port) on the isolated drum stem."""
from __future__ import annotations

import contextlib
import io
from pathlib import Path

import numpy as np

from .kit import ADTOF_LABELS

MODEL_NAME = "adtof-pytorch frame_rnn (5-class)"
FPS = 100
_model = None


def _get_model():
    global _model
    if _model is None:
        from adtof_pytorch import (calculate_n_bins, create_frame_rnn_model,
                                   get_default_weights_path, load_pytorch_weights)

        model = create_frame_rnn_model(calculate_n_bins())
        model.eval()
        weights = get_default_weights_path()
        if not weights or not Path(weights).exists():
            raise RuntimeError("ADTOF weights not found in the adtof_pytorch package")
        with contextlib.redirect_stdout(io.StringIO()):
            model = load_pytorch_weights(model, weights, strict=False)
        _model = model
    return _model


def detect_hits(audio: np.ndarray, sr: int = 44100) -> list[dict]:
    """[{t, d, v, c}] sorted by time: seconds, drum class, velocity 1-127, model confidence 0-1."""
    import torch
    from adtof_pytorch import FRAME_RNN_THRESHOLDS, LABELS_5, PeakPicker
    from adtof_pytorch.audio import create_adtof_processor

    if sr != 44100:
        raise ValueError("ADTOF expects 44.1 kHz audio")
    proc = create_adtof_processor()
    mono = (audio.mean(0) if audio.ndim == 2 else audio).astype(np.float32)
    spec = proc.apply_filterbank(proc.compute_stft(mono)).T
    with torch.no_grad():
        act = _get_model()(torch.from_numpy(np.ascontiguousarray(spec[None, :, :, None])).float()).numpy()[0]
    peaks = PeakPicker(thresholds=list(FRAME_RNN_THRESHOLDS), fps=FPS).pick(act[None], labels=LABELS_5)[0]

    win = int(0.05 * sr)
    hits = []
    for col, label in enumerate(LABELS_5):
        times = np.asarray(peaks[label], dtype=np.float64)
        if len(times) == 0:
            continue
        conf = act[np.clip(np.round(times * FPS).astype(int), 0, len(act) - 1), col]
        # ADTOF has no velocity output: use loudness of the 50 ms after the onset, scaled per drum
        rms = np.array([float(np.sqrt(np.mean(mono[max(0, int(t * sr) - 220):int(t * sr) + win] ** 2) + 1e-12)) for t in times])
        vel = np.clip(np.round(127 * np.sqrt(np.clip(rms / (np.percentile(rms, 95) + 1e-9), 0, 1))), 20, 127)
        hits += [{"t": round(float(t), 4), "d": ADTOF_LABELS[label], "v": int(v), "c": round(float(c), 3)}
                 for t, c, v in zip(times, conf, vel)]
    hits.sort(key=lambda h: (h["t"], h["d"]))
    return hits
