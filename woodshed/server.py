"""The whole app in one process: API, a one-at-a-time import worker, and the built frontend."""
from __future__ import annotations

import json
import logging
import queue
import shutil
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, library
from .audio import AudioError
from .grid import derive
from .kit import DEFAULT_PAD_MAP, DRUMS, FAMILIES, FAMILY, NOTATION
from .lyrics import parse_lrc
from .notation import to_midi, to_musicxml
from .youtube import clean_title, is_url

log = logging.getLogger("woodshed")
AUDIO_EXT = {"mp3", "wav", "m4a", "flac", "ogg", "opus", "aac", "webm", "mp4"}
MAX_UPLOAD = 300 * 1024 * 1024
FRONTEND = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app = FastAPI(title="Woodshed", version=__version__)
_jobs: "queue.Queue[tuple[str, str | None]]" = queue.Queue()


def _worker() -> None:
    from . import pipeline, youtube

    while True:
        song_id, url = _jobs.get()
        try:
            d = library.song_dir(song_id)
        except KeyError:
            continue  # deleted while queued
        try:
            library.update_song(d, status="processing", stage="starting", progress=1)
            if url:
                library.update_song(d, stage="downloading", progress=2)
                info = youtube.fetch(url, d)
                song = library.read_song(d)
                # keep what the user typed; fill in what they left blank
                library.update_song(d, title=song["title"] if song.get("titled") else info["title"],
                                    artist=song["artist"] or info["artist"], source=info["url"])
                audio = Path(info["path"])
            else:
                audio = next(d.glob("original.*"))

            def progress(stage: str, pct: int) -> None:
                library.update_song(d, stage=stage, progress=pct)

            chart = pipeline.process(d, audio, progress=progress)
            library.update_song(d, status="ready", stage="done", progress=100, duration_s=chart["duration_s"])
        except (AudioError, RuntimeError) as e:
            library.update_song(d, status="error", error=str(e))
        except Exception as e:  # noqa: BLE001
            log.exception("Import failed for %s", song_id)
            library.update_song(d, status="error", error=f"{type(e).__name__}: {e}"[:500])


@app.on_event("startup")
def _startup() -> None:
    # songs left mid-import by a previous run can never finish: say so instead of spinning forever
    for song in library.list_songs():
        if song["status"] in ("queued", "processing"):
            library.update_song(library.song_dir(song["id"]), status="error",
                                error="Import was interrupted (the app was restarted). Delete it and import again.")
    threading.Thread(target=_worker, daemon=True, name="import-worker").start()


def _dir(song_id: str) -> Path:
    try:
        return library.song_dir(song_id)
    except KeyError:
        raise HTTPException(404, "Song not found") from None


def _ready(song_id: str) -> Path:
    d = _dir(song_id)
    if not (d / "chart.json").exists():
        raise HTTPException(409, "Song is not ready yet")
    return d


@app.get("/api/health")
def health():
    return {"ok": True, "version": __version__, "queued": _jobs.qsize()}


@app.get("/api/kit")
def kit():
    """Drum vocabulary + default pad map, so the browser and the server agree."""
    return {"drums": DRUMS, "families": FAMILIES, "family": FAMILY,
            "names": {k: v["name"] for k, v in NOTATION.items()},
            "pad_map": {str(k): v for k, v in DEFAULT_PAD_MAP.items()}}


@app.get("/api/songs")
def songs():
    return library.list_songs()


@app.post("/api/songs", status_code=201)
async def import_song(file: UploadFile | None = File(None), url: str = Form(""),
                      title: str = Form(""), artist: str = Form("")):
    """Import from an uploaded file or from a link."""
    title, artist, url = title.strip(), artist.strip(), url.strip()
    if file is None and not url:
        raise HTTPException(400, "Give a file or a link")
    if file is not None:
        name = Path(file.filename or "audio").name
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in AUDIO_EXT:
            raise HTTPException(400, f"Unsupported file type .{ext}")
        if not title:
            guess_artist, guess_title = clean_title(Path(name).stem.replace("_", " "))
            title, artist = guess_title, artist or guess_artist
        song = library.create(title, artist, source=name)
        d = library.song_dir(song["id"])
        size = 0
        with open(d / f"original.{ext}", "wb") as out:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    out.close()
                    shutil.rmtree(d, ignore_errors=True)
                    raise HTTPException(413, "File too large")
                out.write(chunk)
        _jobs.put((song["id"], None))
    else:
        if not is_url(url):
            raise HTTPException(400, "That does not look like a link")
        song = library.create(title or "Fetching…", artist, source=url)
        library.update_song(library.song_dir(song["id"]), titled=bool(title))
        _jobs.put((song["id"], url))
    return library.read_song(library.song_dir(song["id"]))


@app.get("/api/songs/{song_id}")
def song(song_id: str):
    return library.read_song(_dir(song_id))


@app.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str):
    _dir(song_id)
    library.delete(song_id)


@app.get("/api/songs/{song_id}/chart")
def get_chart(song_id: str):
    d = _ready(song_id)
    chart = library.read_chart(d)
    return {"song": library.read_song(d), "chart": chart, "derived": derive(chart)}


def _validate(chart: dict) -> dict:
    if not isinstance(chart, dict) or not isinstance(chart.get("drums"), list) or not isinstance(chart.get("beats"), list):
        raise HTTPException(422, "Not a chart")
    for h in chart["drums"]:
        if not isinstance(h.get("t"), (int, float)) or h.get("d") not in DRUMS:
            raise HTTPException(422, f"Bad drum hit: {json.dumps(h)[:80]}")
        h.setdefault("v", 100)
        h.setdefault("c", 1.0)
    chart["drums"].sort(key=lambda h: (h["t"], h["d"]))
    chart["chords"] = sorted([c for c in chart.get("chords") or [] if isinstance(c.get("t"), (int, float))],
                             key=lambda c: c["t"])
    lyr = chart.get("lyrics") or {}
    if isinstance(lyr.get("lrc"), str):          # the editor may send raw LRC text
        lyr["lines"] = parse_lrc(lyr.pop("lrc"))
        lyr["source"] = "manual"
    lyr.setdefault("lines", [])
    lyr.setdefault("offset_s", 0.0)
    chart["lyrics"] = lyr
    chart["meter"] = chart.get("meter") or {}
    return chart


@app.put("/api/songs/{song_id}/chart")
def put_chart(song_id: str, chart: dict):
    d = _ready(song_id)
    chart = _validate(chart)
    try:
        derived = derive(chart)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"That chart cannot be laid out: {e}") from e
    library.write_chart(d, chart)
    if chart.get("title"):
        library.update_song(d, title=chart["title"], artist=chart.get("artist", ""))
    return {"song": library.read_song(d), "chart": chart, "derived": derived}


@app.post("/api/songs/{song_id}/chart/preview")
def preview_chart(song_id: str, chart: dict):
    """Lay out an edited chart without saving it (the editor calls this as you work)."""
    _ready(song_id)
    chart = _validate(chart)
    try:
        derived = derive(chart)
        return {"chart": chart, "derived": derived, "musicxml": to_musicxml(chart, derived)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"That chart cannot be laid out: {e}") from e


@app.post("/api/songs/{song_id}/chart/revert")
def revert_chart(song_id: str):
    d = _ready(song_id)
    if not (d / "chart.draft.json").exists():
        raise HTTPException(404, "No draft to go back to")
    chart = json.loads((d / "chart.draft.json").read_text())
    library.write_chart(d, chart)
    return {"song": library.read_song(d), "chart": chart, "derived": derive(chart)}


@app.get("/api/songs/{song_id}/score.musicxml")
def musicxml(song_id: str, download: bool = False):
    d = _ready(song_id)
    chart = library.read_chart(d)
    headers = {"Content-Disposition": f'attachment; filename="{song_id}.musicxml"'} if download else {}
    return Response(to_musicxml(chart, derive(chart)), media_type="application/vnd.recordare.musicxml+xml", headers=headers)


@app.get("/api/songs/{song_id}/score.mid")
def midi(song_id: str):
    import io

    d = _ready(song_id)
    chart = library.read_chart(d)
    buf = io.BytesIO()
    to_midi(chart, derive(chart)).save(file=buf)
    return Response(buf.getvalue(), media_type="audio/midi",
                    headers={"Content-Disposition": f'attachment; filename="{song_id}.mid"'})


@app.get("/api/songs/{song_id}/stems/{name}")
def stem(song_id: str, name: str):
    d = _ready(song_id)
    if name not in library.STEMS:
        raise HTTPException(404, "Unknown stem")
    path = d / "stems" / f"{name}.flac"
    if not path.exists():
        raise HTTPException(404, "Stem missing")
    return FileResponse(path, media_type="audio/flac")


@app.get("/api/songs/{song_id}/peaks")
def peaks(song_id: str):
    d = _ready(song_id)
    if not (d / "peaks.json").exists():
        return JSONResponse({"per_second": 100, "drums": [], "vocals": []})
    return FileResponse(d / "peaks.json", media_type="application/json")


if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
else:
    @app.get("/")
    def no_frontend():
        return JSONResponse({"message": "The frontend is not built yet. Run ./run.sh (or `cd frontend && npm ci && npm run build`)."})
