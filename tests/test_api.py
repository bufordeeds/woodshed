"""API tests against a library folder prepared by hand (no audio processing)."""
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WOODSHED_LIBRARY", str(tmp_path))
    from woodshed import library, server

    song = library.create("Test Song", "Tester", source="x.mp3")
    d = library.song_dir(song["id"])
    beats = [round(1.0 + 0.5 * i, 3) for i in range(16)]
    chart = {"version": 1, "title": "Test Song", "artist": "Tester", "duration_s": 9.0, "beats": beats,
             "downbeats": beats[::4], "meter": {}, "key": "C",
             "drums": [{"t": 1.0, "d": "kick", "v": 100, "c": 0.9}, {"t": 1.5, "d": "snare", "v": 90, "c": 0.3}],
             "chords": [{"t": 1.0, "name": "C"}], "lyrics": {"source": "none", "offset_s": 0, "lines": []}}
    library.write_chart(d, chart, draft=True)
    library.update_song(d, status="ready", progress=100)
    with TestClient(server.app) as c:
        c.song_id = song["id"]
        yield c


def test_library_and_chart(client):
    sid = client.song_id
    assert [s["id"] for s in client.get("/api/songs").json()] == [sid]
    b = client.get(f"/api/songs/{sid}/chart").json()
    assert b["derived"]["time_signature"] == [4, 4] and len(b["derived"]["notes"]) == 2
    assert "<score-partwise" in client.get(f"/api/songs/{sid}/score.musicxml").text
    assert client.get(f"/api/songs/{sid}/score.mid").content[:4] == b"MThd"
    assert client.get("/api/kit").json()["pad_map"]["36"] == "kick"


def test_edit_preview_save_revert(client):
    sid = client.song_id
    chart = client.get(f"/api/songs/{sid}/chart").json()["chart"]
    chart["drums"].append({"t": 2.0, "d": "hihat_open"})
    chart["meter"] = {"beats_per_bar": 3}
    chart["lyrics"] = {"lrc": "[00:01.00] one\n[00:03.00] two", "offset_s": 0.5}
    pre = client.post(f"/api/songs/{sid}/chart/preview", json=chart).json()
    assert pre["derived"]["time_signature"] == [3, 4] and "circle-x" in pre["musicxml"]
    assert len(client.get(f"/api/songs/{sid}/chart").json()["chart"]["drums"]) == 2      # preview does not save
    saved = client.put(f"/api/songs/{sid}/chart", json=chart).json()
    assert len(saved["chart"]["drums"]) == 3 and saved["chart"]["drums"][-1]["v"] == 100
    assert [l["text"] for l in saved["chart"]["lyrics"]["lines"]] == ["one", "two"] and saved["chart"]["lyrics"]["source"] == "manual"
    reverted = client.post(f"/api/songs/{sid}/chart/revert").json()
    assert len(reverted["chart"]["drums"]) == 2 and reverted["chart"]["meter"] == {}


def test_bad_input_is_rejected(client):
    sid = client.song_id
    chart = client.get(f"/api/songs/{sid}/chart").json()["chart"]
    chart["drums"].append({"t": 2.0, "d": "cowbell"})
    assert client.put(f"/api/songs/{sid}/chart", json=chart).status_code == 422
    assert client.put(f"/api/songs/{sid}/chart", json={"nope": 1}).status_code == 422
    assert client.get("/api/songs/does-not-exist").status_code == 404
    assert client.get("/api/songs/..%2F..%2Fetc/chart").status_code == 404
    assert client.get(f"/api/songs/{sid}/stems/passwd").status_code == 404
    assert client.post("/api/songs", data={"url": "file:///etc/passwd"}).status_code == 400
    assert client.post("/api/songs", data={}).status_code == 400
    assert client.post("/api/songs", files={"file": ("x.exe", b"MZ")}).status_code == 400


def test_delete(client):
    sid = client.song_id
    assert client.delete(f"/api/songs/{sid}").status_code == 204
    assert client.get("/api/songs").json() == []


def test_interrupted_imports_are_flagged_on_startup(tmp_path, monkeypatch):
    monkeypatch.setenv("WOODSHED_LIBRARY", str(tmp_path))
    from woodshed import library, server

    song = library.create("Half done")
    library.update_song(library.song_dir(song["id"]), status="processing", progress=40)
    with TestClient(server.app) as c:
        s = c.get(f"/api/songs/{song['id']}").json()
    assert s["status"] == "error" and "interrupted" in s["error"]
    assert json.loads((tmp_path / song["id"] / "song.json").read_text())["status"] == "error"
