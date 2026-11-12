"""Fetch a song's audio from a link with yt-dlp (local, personal use)."""
from __future__ import annotations

import re
from pathlib import Path

_JUNK = re.compile(r"\s*[\(\[][^\)\]]*(official|audio|video|lyric|visuali[sz]er|remaster|hd|4k|mv)[^\)\]]*[\)\]]", re.I)


def clean_title(raw: str) -> tuple[str, str]:
    """('Artist', 'Title') guessed from a video title like 'Artist - Title (Official Video)'."""
    t = _JUNK.sub("", raw or "").strip()
    if " - " in t:
        artist, title = t.split(" - ", 1)
        return artist.strip(), title.strip()
    return "", t


def is_url(s: str) -> bool:
    return bool(re.match(r"^https?://", s.strip(), re.I))


def fetch(url: str, out_dir: str | Path) -> dict:
    """Download the best audio stream. Returns {path, title, artist, duration, url}."""
    import yt_dlp

    if not is_url(url):
        raise ValueError("Not a link")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    opts = {"format": "bestaudio/best", "noplaylist": True, "quiet": True, "no_warnings": True,
            "outtmpl": str(out / "original.%(ext)s"), "retries": 3}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            path = Path(ydl.prepare_filename(info))
    except Exception as e:  # yt_dlp raises its own DownloadError with a long message
        msg = str(e).replace("ERROR: ", "").strip().splitlines()[0]
        raise RuntimeError(f"Could not download from that link: {msg}") from e
    guess_artist, guess_title = clean_title(info.get("title") or "")
    return {
        "path": str(path),
        "title": info.get("track") or guess_title or info.get("title") or "Untitled",
        "artist": info.get("artist") or guess_artist or info.get("uploader") or "",
        "duration": info.get("duration"),
        "url": info.get("webpage_url") or url,
    }
