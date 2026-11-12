"""Import pipeline: audio file -> stems + a draft chart (tempo, drums, chords, lyrics)."""
from __future__ import annotations

import json
import logging
import math
import threading
import time
from pathlib import Path
from typing import Callable

import numpy as np

from . import __version__, library
from .audio import SAMPLE_RATE, AudioError, load_audio, write_audio
from .grid import derive, flat_beats

log = logging.getLogger(__name__)

MAX_DURATION_S = 15 * 60
MIN_DURATION_S = 5
Progress = Callable[[str, int], None]


class _Ticker:
    """Demucs has no progress callback: ease the bar towards `hi` on an estimate while it runs."""

    def __init__(self, report: Callable[[int], None], lo: int, hi: int, expected_s: float):
        self.report, self.lo, self.hi, self.expected = report, lo, hi, max(expected_s, 1.0)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        t0, last = time.time(), self.lo
        while not self._stop.wait(2.0):
            pct = int(self.lo + (self.hi - self.lo) * (1 - math.exp(-1.5 * (time.time() - t0) / self.expected)))
            if pct > last:
                last = pct
                try:
                    self.report(pct)
                except Exception:  # noqa: BLE001
                    pass

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join(timeout=5)


def peaks(audio: np.ndarray, per_second: int = 100) -> list[int]:
    """Waveform overview: peak level 0-255 per 10 ms."""
    mono = np.abs(audio).max(0) if audio.ndim == 2 else np.abs(audio)
    hop = SAMPLE_RATE // per_second
    n = len(mono) // hop
    if n == 0:
        return []
    p = mono[:n * hop].reshape(n, hop).max(1)
    return np.clip(np.round(255 * p / (p.max() + 1e-9)), 0, 255).astype(int).tolist()


def process(d: Path, audio_path: Path, *, progress: Progress | None = None, lyrics: bool = True) -> dict:
    """Fill a song folder from its original audio. Returns the draft chart."""
    from . import beats as beats_mod
    from . import chords as chords_mod
    from . import drums as drums_mod
    from . import lyrics as lyrics_mod
    from . import separate as sep_mod

    def step(stage: str, pct: int) -> None:
        log.info("%3d%% %s", pct, stage)
        if progress:
            progress(stage, pct)

    song = library.read_song(d)
    timings: dict[str, float] = {}
    t_all = time.time()

    step("reading_audio", 2)
    mix = load_audio(audio_path)
    duration = mix.shape[1] / SAMPLE_RATE
    if duration < MIN_DURATION_S:
        raise AudioError(f"Audio too short ({duration:.1f}s)")
    if duration > MAX_DURATION_S:
        raise AudioError(f"Audio too long ({duration / 60:.1f} min, maximum {MAX_DURATION_S // 60})")

    step("separating_stems", 6)
    t = time.time()
    with _Ticker(lambda pct: progress and progress("separating_stems", pct), 6, 60, expected_s=0.7 * duration + 5):
        stems = sep_mod.separate(mix, SAMPLE_RATE)
    (d / "stems").mkdir(exist_ok=True)
    for name, data in stems.items():
        write_audio(d / "stems" / f"{name}.flac", data)
    timings["separation"] = time.time() - t

    step("finding_drum_hits", 62)
    t = time.time()
    hits = drums_mod.detect_hits(stems["drums"], SAMPLE_RATE)
    timings["drums"] = time.time() - t

    step("finding_beats", 70)
    t = time.time()
    beats, downbeats, beat_backend = beats_mod.track_beats(mix, SAMPLE_RATE)
    timings["beats"] = time.time() - t

    chart = {
        "version": 1, "title": song["title"], "artist": song.get("artist", ""),
        "duration_s": round(duration, 3),
        "beats": beats, "downbeats": downbeats, "meter": {},
        "drums": hits, "chords": [], "key": "",
        "lyrics": {"source": "none", "offset_s": 0.0, "lines": []},
        "models": {"woodshed": __version__, "separation": sep_mod.MODEL_NAME,
                   "drums": drums_mod.MODEL_NAME, "beats": beat_backend},
    }
    derived = derive(chart)

    step("finding_chords", 78)
    t = time.time()
    try:
        g = flat_beats(derived["bars"])
        chart["chords"], chart["key"] = chords_mod.estimate_chords(
            stems["other"].mean(0), stems["bass"].mean(0), SAMPLE_RATE, g[(g >= 0) & (g <= duration)])
    except Exception:  # noqa: BLE001 - chords are optional
        log.exception("Chord estimation failed")
    timings["chords"] = time.time() - t

    if lyrics:
        step("finding_lyrics", 86)
        t = time.time()
        try:
            found = lyrics_mod.fetch_lrclib(song["title"], song.get("artist", ""), duration)
            if found and found["lines"]:
                offset, gain = lyrics_mod.align_offset(found["lines"], stems["vocals"], SAMPLE_RATE)
                # only trust a shift that clearly beats "no shift"
                offset = offset if gain > 0.08 else 0.0
                chart["lyrics"] = {"source": "lrclib", "offset_s": offset, "lines": found["lines"],
                                   "matched": f"{found['artist']} - {found['track']}"}
            else:
                step("transcribing_lyrics", 88)
                lines = lyrics_mod.transcribe_vocals(str(d / "stems" / "vocals.flac"))
                if lines:
                    chart["lyrics"] = {"source": "whisper", "offset_s": 0.0, "lines": lines}
        except Exception:  # noqa: BLE001 - lyrics are optional
            log.exception("Lyrics step failed")
        timings["lyrics"] = time.time() - t

    step("saving", 96)
    (d / "peaks.json").write_text(json.dumps({"per_second": 100, "drums": peaks(stems["drums"]),
                                              "vocals": peaks(stems["vocals"])}))
    timings["total"] = time.time() - t_all
    chart["timings_s"] = {k: round(v, 1) for k, v in timings.items()}
    library.write_chart(d, chart, draft=True)
    return chart
