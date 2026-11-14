"""The song library: one folder per song, plain files, no database.

    library/<song id>/
        song.json        title, artist, source, processing status
        chart.json       the editable chart (beats, meter, drums, lyrics, chords)  <- source of truth
        chart.draft.json the untouched machine draft, for "start over"
        original.*       the audio as imported
        stems/*.flac     drums, bass, other, vocals
        peaks.json       waveform overviews for the editor
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import threading
import time
from pathlib import Path

STEMS = ["drums", "bass", "other", "vocals"]
_lock = threading.Lock()


def root() -> Path:
    p = Path(os.environ.get("WOODSHED_LIBRARY", "library")).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "song"


def song_dir(song_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]{1,80}", song_id):
        raise KeyError(song_id)
    d = root() / song_id
    if not (d / "song.json").exists():
        raise KeyError(song_id)
    return d


def create(title: str, artist: str = "", source: str = "") -> dict:
    song_id = f"{_slug(f'{artist} {title}'.strip())}-{secrets.token_hex(2)}"
    d = root() / song_id
    (d / "stems").mkdir(parents=True)
    song = {"id": song_id, "title": title or "Untitled", "artist": artist, "source": source,
            "status": "queued", "stage": "queued", "progress": 0, "error": None, "created": time.time()}
    write_song(d, song)
    return song


def read_song(d: Path) -> dict:
    return json.loads((d / "song.json").read_text())


def write_song(d: Path, song: dict) -> None:
    with _lock:
        tmp = d / "song.json.tmp"
        tmp.write_text(json.dumps(song, indent=1))
        tmp.replace(d / "song.json")


def update_song(d: Path, **fields) -> dict:
    song = read_song(d)
    song.update(fields)
    write_song(d, song)
    return song


def list_songs() -> list[dict]:
    songs = []
    for d in root().iterdir():
        if (d / "song.json").exists():
            try:
                songs.append(read_song(d))
            except json.JSONDecodeError:
                continue
    return sorted(songs, key=lambda s: -s.get("created", 0))


def read_chart(d: Path) -> dict:
    return json.loads((d / "chart.json").read_text())


def write_chart(d: Path, chart: dict, *, draft: bool = False) -> None:
    with _lock:
        if (d / "chart.json").exists():
            shutil.copyfile(d / "chart.json", d / "chart.prev.json")   # one level of undo on disk
        tmp = d / "chart.json.tmp"
        tmp.write_text(json.dumps(chart, indent=1))
        tmp.replace(d / "chart.json")
        if draft:
            shutil.copyfile(d / "chart.json", d / "chart.draft.json")


def delete(song_id: str) -> None:
    shutil.rmtree(song_dir(song_id))
