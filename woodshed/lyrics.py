"""Lyrics draft: synced lyrics from LRCLIB when the song is known, else Whisper on the vocal stem."""
from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request

import numpy as np

log = logging.getLogger(__name__)

LRCLIB = "https://lrclib.net/api"
_UA = "woodshed/0.1 (personal practice tool)"
_TAG = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")


def parse_lrc(text: str) -> list[dict]:
    lines = []
    for raw in text.splitlines():
        stamps = _TAG.findall(raw)
        words = _TAG.sub("", raw).strip()
        for m, s in stamps:
            lines.append({"t": round(int(m) * 60 + float(s), 2), "text": words})
    lines.sort(key=lambda x: x["t"])
    return lines


def to_lrc(lines: list[dict]) -> str:
    return "\n".join(f"[{int(l['t'] // 60):02d}:{l['t'] % 60:05.2f}] {l['text']}" for l in lines)


def fetch_lrclib(title: str, artist: str, duration: float | None = None, timeout: float = 15) -> dict | None:
    """Best synced-lyrics match, or None. Sends only the song title and artist."""
    if not title:
        return None
    q = urllib.parse.urlencode({"track_name": title, "artist_name": artist or ""})
    req = urllib.request.Request(f"{LRCLIB}/search?{q}", headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            results = json.load(r)
    except Exception as e:  # noqa: BLE001 - offline is fine, lyrics are optional
        log.info("LRCLIB lookup failed: %s", e)
        return None
    synced = [r for r in results if r.get("syncedLyrics")]
    if not synced:
        return None
    if duration:
        synced.sort(key=lambda r: abs((r.get("duration") or 0) - duration))
    best = synced[0]
    return {"lines": parse_lrc(best["syncedLyrics"]), "track": best.get("trackName"), "artist": best.get("artistName"),
            "album": best.get("albumName"), "duration": best.get("duration")}


def vocal_activity(vocals: np.ndarray, sr: int, hop_s: float = 0.05) -> np.ndarray:
    """0..1 loudness envelope of the vocal stem, one value per `hop_s`."""
    mono = vocals.mean(0) if vocals.ndim == 2 else vocals
    hop = int(hop_s * sr)
    n = len(mono) // hop
    if n == 0:
        return np.zeros(0)
    rms = np.sqrt((mono[:n * hop].reshape(n, hop) ** 2).mean(1))
    ref = np.percentile(rms, 95) + 1e-9
    return np.clip(rms / ref, 0, 1)


def align_offset(lines: list[dict], vocals: np.ndarray, sr: int, search_s: float = 25.0) -> tuple[float, float]:
    """Global shift (seconds) that best lines the lyric timestamps up with where singing starts.

    The audio you imported is often not the exact release the lyrics were timed to
    (video intros, different masters). Returns (offset, gain over no shift).
    """
    hop_s = 0.05
    act = vocal_activity(vocals, sr, hop_s)
    starts = np.array([l["t"] for l in lines if l["text"]])
    if len(act) == 0 or len(starts) < 4:
        return 0.0, 0.0
    after, before = int(0.6 / hop_s), int(0.4 / hop_s)
    csum = np.concatenate([[0.0], np.cumsum(act)])

    def score(off: float) -> float:
        idx = np.round((starts + off) / hop_s).astype(int)
        ok = (idx - before >= 0) & (idx + after < len(act))
        if ok.sum() < len(starts) * 0.7:
            return -1.0
        i = idx[ok]
        return float(((csum[i + after] - csum[i]) / after - (csum[i] - csum[i - before]) / before).mean())

    offsets = np.arange(-search_s, search_s + 1e-9, hop_s)
    scores = np.array([score(o) for o in offsets])
    best = int(scores.argmax())
    zero = score(0.0)
    return round(float(offsets[best]), 2), round(float(scores[best] - zero), 3)


def transcribe_vocals(vocals_path: str, model_size: str = "small") -> list[dict] | None:
    """Whisper on the isolated vocals -> lines with word timings. None if faster-whisper is unavailable."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(vocals_path, word_timestamps=True, vad_filter=True, beam_size=3)
        lines = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            words = [{"t": round(w.start, 2), "w": w.word.strip()} for w in (seg.words or [])]
            lines.append({"t": round(words[0]["t"] if words else seg.start, 2), "text": text, "words": words})
        return lines
    except Exception as e:  # noqa: BLE001
        log.warning("Whisper transcription failed: %s", e)
        return None
