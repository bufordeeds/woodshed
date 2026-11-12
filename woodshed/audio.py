"""Audio I/O. Decoding goes through the ffmpeg binary so mp3/wav/m4a/flac all work."""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 44100


class AudioError(ValueError):
    pass


def load_audio(path: str | Path, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Decode any ffmpeg-readable file to float32 stereo, shape (2, n)."""
    path = Path(path)
    if not path.exists():
        raise AudioError(f"Audio file not found: {path}")
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-vn",
           "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", str(sr), "-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=False)
    except FileNotFoundError as e:  # pragma: no cover
        raise AudioError("ffmpeg is not installed") from e
    if proc.returncode != 0 or len(proc.stdout) == 0:
        msg = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        raise AudioError(f"Could not decode audio: {msg[-1] if msg else 'unknown ffmpeg error'}")
    audio = np.frombuffer(proc.stdout, dtype=np.float32).reshape(-1, 2).T
    return np.ascontiguousarray(audio)


def write_audio(path: str | Path, audio: np.ndarray, sr: int = SAMPLE_RATE) -> None:
    """Write (channels, n) float audio. Format from extension (.flac / .wav), 16-bit."""
    data = np.clip(audio.T, -1.0, 1.0)
    sf.write(str(path), data, sr, subtype="PCM_16")
