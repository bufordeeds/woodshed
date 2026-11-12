"""Chord draft: one major/minor chord per beat from the non-drum stems.

Deliberately simple (chroma + templates + smoothing, no trained model): it gets
the common pop changes roughly right and is meant to be corrected in the editor.
No 7ths/sus/slash chords are detected.
"""
from __future__ import annotations

import numpy as np

SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])  # Krumhansl key profiles
_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
# keys conventionally written with flats: (tonic pitch class, is_minor)
_FLAT_KEYS = {(5, False), (10, False), (3, False), (8, False), (1, False), (6, False),
              (2, True), (7, True), (0, True), (5, True), (10, True), (3, True)}


def _templates() -> np.ndarray:
    t = np.zeros((24, 12))
    for r in range(12):
        t[r, [r, (r + 4) % 12, (r + 7) % 12]] = 1.0          # major
        t[12 + r, [r, (r + 3) % 12, (r + 7) % 12]] = 1.0     # minor
    return t / np.linalg.norm(t, axis=1, keepdims=True)


def estimate_key(chroma_sum: np.ndarray) -> tuple[int, bool]:
    best = (-2.0, 0, False)
    for r in range(12):
        for minor, prof in ((False, _MAJ), (True, _MIN)):
            c = np.corrcoef(np.roll(prof, r), chroma_sum)[0, 1]
            if c > best[0]:
                best = (c, r, minor)
    return best[1], best[2]


def estimate_chords(harmony: np.ndarray, bass: np.ndarray, sr: int, beat_times: np.ndarray,
                    change_penalty: float = 1.2) -> tuple[list[dict], str]:
    """Returns ([{t, name}] at chord changes, key name). `harmony`/`bass` are mono signals."""
    import librosa

    if len(beat_times) < 2:
        return [], ""
    target = 22050
    hop = 2048
    feats = []
    for y in (harmony, bass):
        y = librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=target)
        tuning = librosa.estimate_tuning(y=y, sr=target) if np.abs(y).max() > 1e-4 else 0.0
        feats.append(librosa.feature.chroma_cqt(y=y, sr=target, hop_length=hop, tuning=tuning, n_octaves=6))
    n = min(f.shape[1] for f in feats)
    frames = np.clip(librosa.time_to_frames(beat_times, sr=target, hop_length=hop), 0, n - 1)
    frames = np.unique(frames)
    if len(frames) < 2:
        return [], ""
    seg_t = librosa.frames_to_time(frames, sr=target, hop_length=hop)
    # snap segment times back onto the beats they came from
    seg_t = np.array([beat_times[np.argmin(np.abs(beat_times - t))] for t in seg_t])
    # one column per beat-to-beat segment (segment i starts at frames[i])
    harm = np.stack([np.median(feats[0][:, a:b], axis=1) for a, b in zip(frames[:-1], frames[1:])], axis=1)
    low = np.stack([np.median(feats[1][:, a:b], axis=1) for a, b in zip(frames[:-1], frames[1:])], axis=1)
    energy = harm.sum(0)
    hn = harm / (np.linalg.norm(harm, axis=0, keepdims=True) + 1e-9)
    ln = low / (low.max(axis=0, keepdims=True) + 1e-9)

    emit = _templates() @ hn                               # (24, segments) cosine similarity
    emit += 0.35 * np.vstack([ln, ln])                     # the bass usually plays the root
    silent = energy < 0.05 * np.median(energy[energy > 0]) if (energy > 0).any() else np.ones_like(energy, bool)
    scores = np.vstack([emit * 8.0, np.where(silent, 20.0, 2.0)[None, :]])   # last row = "no chord"

    # Viterbi with a flat penalty for changing chord
    S, T = scores.shape
    best = scores[:, 0].copy()
    back = np.zeros((S, T), dtype=int)
    for t in range(1, T):
        stay = best
        jump = best.max() - change_penalty
        back[:, t] = np.where(stay >= jump, np.arange(S), best.argmax())
        best = np.maximum(stay, jump) + scores[:, t]
    path = [int(best.argmax())]
    for t in range(T - 1, 0, -1):
        path.append(int(back[path[-1], t]))
    path.reverse()

    root, minor = estimate_key(harm.sum(1))
    names = FLAT if (root, minor) in _FLAT_KEYS else SHARP
    key = names[root] + ("m" if minor else "")
    out, prev = [], None
    for i, s in enumerate(path):
        name = "N" if s == 24 else names[s % 12] + ("m" if s >= 12 else "")
        if name != prev:
            out.append({"t": round(float(seg_t[i]), 3), "name": name})
            prev = name
    return [c for c in out if c["name"] != "N" or out.index(c) > 0], key
