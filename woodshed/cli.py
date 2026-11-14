"""`woodshed` starts the app; `woodshed import <file-or-link>` processes one song from the terminal."""
from __future__ import annotations

import argparse
import logging
import shutil
import sys
from collections import Counter
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="woodshed", description="Private practice room: import songs, fix the chart, play along.")
    sub = p.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="start the app (default)")
    s.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to let other devices on your network connect")
    s.add_argument("--port", type=int, default=8000)
    i = sub.add_parser("import", help="import one song without starting the app")
    i.add_argument("source", help="audio file or link")
    i.add_argument("--title", default="")
    i.add_argument("--artist", default="")
    i.add_argument("--no-lyrics", action="store_true")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if a.cmd == "import":
        from . import library, pipeline, youtube
        from .grid import derive

        if youtube.is_url(a.source):
            song = library.create(a.title or "Fetching…", a.artist, source=a.source)
            d = library.song_dir(song["id"])
            info = youtube.fetch(a.source, d)
            library.update_song(d, title=a.title or info["title"], artist=a.artist or info["artist"])
            audio = Path(info["path"])
        else:
            src = Path(a.source)
            if not src.exists():
                print(f"error: {src} does not exist", file=sys.stderr)
                return 2
            guess_artist, guess_title = youtube.clean_title(src.stem.replace("_", " "))
            song = library.create(a.title or guess_title, a.artist or guess_artist, source=src.name)
            d = library.song_dir(song["id"])
            audio = d / f"original{src.suffix.lower()}"
            shutil.copyfile(src, audio)
        chart = pipeline.process(d, audio, lyrics=not a.no_lyrics)
        library.update_song(d, status="ready", stage="done", progress=100, duration_s=chart["duration_s"])
        dv = derive(chart)
        counts = Counter(h["d"] for h in chart["drums"])
        print(f"{d}\n{dv['time_signature'][0]}/{dv['time_signature'][1]} at ~{dv['tempo_bpm']} BPM, {len(dv['bars'])} bars, "
              f"{len(chart['drums'])} drum hits ({', '.join(f'{k} {v}' for k, v in sorted(counts.items()))}), "
              f"{len(chart['chords'])} chord changes (key {chart['key'] or '?'}), "
              f"lyrics: {chart['lyrics']['source']} ({len(chart['lyrics']['lines'])} lines)")
        return 0

    import uvicorn

    host, port = getattr(a, "host", "127.0.0.1"), getattr(a, "port", 8000)
    print(f"Woodshed is starting on http://{host}:{port}")
    uvicorn.run("woodshed.server:app", host=host, port=port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
