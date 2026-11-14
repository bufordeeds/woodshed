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


def _on_beat(beats: np.ndarray, hits, prefixes: tuple[str, ...]) -> np.ndarray:
    """Summed confidence of the hits of one drum family that land on each beat (not between beats)."""
    n = len(beats)
    out = np.zeros(n)
    for h in hits or []:
        if not str(h.get("d", "")).startswith(prefixes):
            continue
        i = int(np.argmin(np.abs(beats - h["t"])))
        span = beats[min(i + 1, n - 1)] - beats[max(i - 1, 0)]
        if abs(beats[i] - h["t"]) <= 0.1 * span:
            out[i] += float(h.get("c", 1.0))
    return out


def double_if_backbeat(beats, hits) -> np.ndarray:
    """A tracker that taps only the backbeat (snare on every beat, kicks in between) is at half speed: add the beats between."""
    b = np.asarray(beats, float)
    if len(b) < 12:
        return b
    mids = (b[:-1] + b[1:]) / 2
    both = np.sort(np.concatenate([b, mids]))
    snare, kick = _on_beat(both, hits, ("snare",)), _on_beat(both, hits, ("kick",))
    on, between = slice(0, None, 2), slice(1, None, 2)
    if (snare[on] > 0).mean() >= 0.8 and (snare[between] > 0).mean() <= 0.2 and (kick[between] > 0).mean() >= 0.4:
        return both
    return b


def downbeats_from_hits(beats, hits) -> np.ndarray | None:
    """Guess the bar lines from the drum part when the beat tracker has no downbeat model.

    Bars are 4 beats unless the kick/snare pattern clearly repeats every 3 or 6 beats instead;
    beat 1 is where kicks and crashes pile up and the snare stays away. None = not enough drums to tell.
    """
    b = np.asarray(beats, float)
    if len(b) < 12:
        return None
    k, s, c = _on_beat(b, hits, ("kick",)), _on_beat(b, hits, ("snare",)), _on_beat(b, hits, ("cymbal", "crash"))
    energy = float(k @ k + s @ s)
    if (k > 0).sum() + (s > 0).sum() < 8 or energy == 0:
        return None

    def repeats(lag: int) -> float:
        return float(k[:-lag] @ k[lag:] + s[:-lag] @ s[lag:]) / energy

    r3, r4, r6 = repeats(3), repeats(4), repeats(6)
    if max(r3, r4, r6) < 0.2:
        return None
    if r6 >= max(0.2, 1.5 * r4, 1.3 * r3):
        per = 6   # e.g. 6/8 counted in eighths: kick on 1 (and 4), snare on 4
    elif r3 >= max(0.2, 1.5 * r4):
        per = 3
    else:
        per = 4

    def fold(x: np.ndarray) -> np.ndarray:
        return np.array([x[j::per].mean() for j in range(per)])

    kf, sf, cf = fold(k), fold(s), fold(c)
    score = kf + cf - 0.5 * sf
    if per == 4:   # kick on 1 and 3, snare on 2 and 4
        score = score + 0.5 * np.roll(kf, -2) + 0.5 * (np.roll(sf, -1) + np.roll(sf, -3))
    elif per == 6:  # 6/8 counted in eighths: snare on 4
        score = score + 0.5 * np.roll(sf, -3)
    if float(np.ptp(score)) < 0.1 * float(np.abs(score).max() + 1e-9):
        return None  # every beat looks the same: no telling where the bar starts
    return b[int(np.argmax(score))::per]


def track_beats(audio: np.ndarray, sr: int = 44100, hits: list[dict] | None = None) -> tuple[list[float], list[float], str]:
    """Return (beats, downbeats, backend_name); times in seconds. `hits` (drum hits) help the last-resort tracker."""
    for name, fn in (("beat_this final0", _beat_this), ("madmom", _madmom), ("librosa", _librosa)):
        try:
            beats, downbeats = fn(audio, sr)
            if name == "librosa":
                beats = double_if_backbeat(beats, hits)
                downbeats = beats[::4]
                guessed = downbeats_from_hits(beats, hits)
                if guessed is not None:
                    downbeats, name = guessed, "librosa + drum pattern"
            return [round(float(b), 4) for b in beats], [round(float(d), 4) for d in downbeats], name
        except ImportError:
            continue
        except Exception as e:  # noqa: BLE001
            log.warning("Beat tracker %s failed: %s", name, e)
    return [], [], "none"
