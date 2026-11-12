"""Beat + downbeat tracking. Beat This! preferred, madmom then librosa as fallbacks."""
from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger(__name__)

_a2b = None


def _beat_this(audio: np.ndarray, sr: int):
    global _a2b
    from beat_this.inference import Audio2Beats

    if _a2b is None:
        _a2b = Audio2Beats(checkpoint_path="final0", device="cpu", dbn=False)
    mono = audio.mean(0) if audio.ndim == 2 else audio
    beats, downbeats = _a2b(mono.astype(np.float32), sr)
    return np.asarray(beats, float), np.asarray(downbeats, float)


def _madmom(audio: np.ndarray, sr: int):
    import madmom  # optional, not installed by default

    mono = audio.mean(0) if audio.ndim == 2 else audio
    sig = madmom.audio.signal.Signal(mono, sample_rate=sr, num_channels=1)
    act = madmom.features.downbeats.RNNDownBeatProcessor()(sig)
    out = madmom.features.downbeats.DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)(act)
    return out[:, 0], out[out[:, 1] == 1, 0]


def _librosa(audio: np.ndarray, sr: int):
    import librosa

    mono = audio.mean(0) if audio.ndim == 2 else audio
    _, frames = librosa.beat.beat_track(y=mono, sr=sr, units="time")
    beats = np.asarray(frames, float)
    return beats, beats[::4]  # no downbeat model: assume 4/4 starting on the first beat


def track_beats(audio: np.ndarray, sr: int = 44100) -> tuple[list[float], list[float], str]:
    """Return (beats, downbeats, backend_name); times in seconds."""
    for name, fn in (("beat_this final0", _beat_this), ("madmom", _madmom), ("librosa", _librosa)):
        try:
            beats, downbeats = fn(audio, sr)
            return [round(float(b), 4) for b in beats], [round(float(d), 4) for d in downbeats], name
        except ImportError:
            continue
        except Exception as e:  # noqa: BLE001
            log.warning("Beat tracker %s failed: %s", name, e)
    return [], [], "none"
