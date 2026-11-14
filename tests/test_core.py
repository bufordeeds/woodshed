"""Fast tests for everything derived from a chart (no ML models needed)."""
import xml.etree.ElementTree as ET

import pytest

from woodshed.grid import derive
from woodshed.lyrics import align_offset, parse_lrc, to_lrc
from woodshed.notation import DIV, chord_beats, to_midi, to_musicxml
from woodshed.youtube import clean_title, is_url


def chart(bpm=120.0, bars=4, hits=None, start=1.0, per_bar=4, **extra):
    beat = 60.0 / bpm
    beats = [round(start + i * beat, 4) for i in range(bars * per_bar)]
    return {"title": "t", "duration_s": start + bars * per_bar * beat, "beats": beats, "downbeats": beats[::per_bar],
            "drums": hits or [], "chords": [], "meter": {}, **extra}


def hit(t, d="snare", c=0.9):
    return {"t": t, "d": d, "v": 100, "c": c}


def measure_durations(xml):
    root = ET.fromstring(xml.split("\n", 2)[2])
    return [sum(int(n.find("duration").text) for n in m.findall("note") if n.find("chord") is None) for m in root.iter("measure")]


def test_straight_four_four():
    d = derive(chart(hits=[hit(1.0, "kick"), hit(1.5), hit(1.625, "hihat")]))
    assert d["time_signature"] == [4, 4] and not d["compound"] and d["qpb"] == 1.0
    assert [(n["bar"], n["beat"], n["slot"], n["div"]) for n in d["notes"]] == [(1, 0, 0, 4), (1, 1, 0, 4), (1, 1, 1, 4)]
    assert d["tempo_bpm"] == pytest.approx(120, abs=0.5)


def test_notes_keep_played_time_and_link_back_to_hits():
    c = chart(hits=[hit(1.49), hit(1.51)])          # two detections of one snare
    d = derive(c)
    assert len(d["notes"]) == 1 and d["notes"][0]["hits"] == [0, 1]
    assert d["notes"][0]["t"] == pytest.approx(1.5) and c["drums"][0]["t"] == 1.49   # source untouched


def test_shuffle_becomes_compound_time():
    # 4 beats per bar, hits on 1 and the last triplet of every beat for 3 bars
    beat = 0.5
    hits = [hit(1.0 + k * beat + f * beat, "hihat") for k in range(12) for f in (0, 2 / 3)]
    d = derive(chart(bars=3, hits=hits))
    assert d["compound"] and d["time_signature"] == [12, 8] and d["qpb"] == 1.5
    assert {n["div"] for n in d["notes"]} == {3} and {n["slot"] for n in d["notes"]} == {0, 2}
    assert measure_durations(to_musicxml(chart(bars=3, hits=hits), d)) == [4 * 18] * len(d["bars"])


def test_tracker_counting_eighths_of_six_eight_is_regrouped():
    # tracker beats on every 8th note, downbeat every 6: should read as 6/8 with two beats per bar
    c = chart(bpm=240, bars=4, per_bar=6, hits=[hit(1.0 + 0.25 * i, "hihat") for i in range(24)])
    d = derive(c)
    assert d["time_signature"] == [6, 8] and d["per_bar"] == 2 and d["compound"]
    assert len(d["bars"]) == 4 and d["auto"]
    assert measure_durations(to_musicxml(c, d)) == [2 * 18] * 4


def test_meter_overrides():
    hits = [hit(1.0 + 0.5 * i, "kick") for i in range(16)]
    base = derive(chart(hits=hits))
    assert len(base["bars"]) == 4
    shifted = derive(chart(hits=hits, meter={"shift": 1}))
    assert shifted["bars"][1]["t0"] == pytest.approx(base["bars"][0]["t0"] + 0.5)
    assert derive(chart(hits=hits, meter={"beats_per_bar": 3}))["time_signature"] == [3, 4]
    assert derive(chart(hits=hits, meter={"tempo": "half"}))["tempo_bpm"] == pytest.approx(60, abs=0.5)
    assert derive(chart(hits=hits, meter={"tempo": "double"}))["tempo_bpm"] == pytest.approx(240, abs=1)
    assert derive(chart(hits=hits, meter={"feel": "compound"}))["time_signature"] == [12, 8]
    nudged = derive(chart(hits=[], meter={"offset_s": 0.05}))
    assert nudged["bars"][0]["t0"] == pytest.approx(1.05)


def test_grid_covers_early_hits_and_fills_tracker_gaps():
    d = derive(chart(hits=[hit(0.52, "kick"), hit(1.0)]))
    assert d["bars"][0]["t0"] < 0.52 and any(abs(b["t0"] - 1.0) < 1e-6 for b in d["bars"])
    c = {"duration_s": 12.0, "beats": [0.0, 0.5, 1.0, 1.5, 2.0] + [8.0 + 0.5 * i for i in range(9)],
         "downbeats": [0.0, 2.0, 8.0, 10.0, 12.0], "drums": [hit(0.0, "kick"), hit(11.5)], "meter": {}}
    d = derive(c)
    flat = [b for bar in d["bars"] for b in bar["beats"]] + [d["bars"][-1]["t1"]]
    gaps = [b - a for a, b in zip(flat, flat[1:])]
    assert min(gaps) > 0.45 and max(gaps) < 0.55
    to_midi(c, d)


def test_no_beats_at_all_still_lays_out():
    d = derive({"duration_s": 4.0, "beats": [], "downbeats": [], "drums": [hit(0.5)], "meter": {}})
    assert d["tempo_bpm"] == 120 and d["notes"][0]["beat"] == 1


def test_musicxml_structure_ids_and_chords():
    c = chart(hits=[hit(1.0, "kick"), hit(1.0, "hihat"), hit(1.125, "hihat"), hit(1.375, "snare"),
                    hit(1.5 + 0.5 / 3, "tom1"), hit(1.5 + 1.0 / 3, "tom3"), hit(2.25, "crash"), hit(2.5, "hihat_open")],
              chords=[{"t": 1.0, "name": "Am"}, {"t": 2.0, "name": "Bb7"}, {"t": 5.0, "name": "F#m7"}], title="T & <Test>")
    d = derive(c)
    xml = to_musicxml(c, d)
    assert measure_durations(xml) == [4 * DIV] * len(d["bars"])
    root = ET.fromstring(xml.split("\n", 2)[2])
    assert root.find("work/work-title").text == "T & <Test>"
    assert {n.get("id") for n in root.iter("note") if n.get("id")} == {n["id"] for n in d["notes"]}
    kinds = [b.text for b in root.iter("beam")]
    assert kinds.count("begin") == kinds.count("end") > 0
    harm = [(h.find("root/root-step").text, h.find("kind").text, h.find("root/root-alter") is not None) for h in root.iter("harmony")]
    assert harm == [("A", "minor", False), ("B", "dominant", True), ("F", "minor-seventh", True)]
    assert {n.text for n in root.iter("notehead")} == {"x", "circle-x"}


def test_chords_snap_to_beats_and_collapse_repeats():
    c = chart(chords=[{"t": 1.02, "name": "C"}, {"t": 1.9, "name": "C"}, {"t": 3.01, "name": "G"}, {"t": 4.0, "name": "N"}])
    assert chord_beats(c, derive(c)) == {0: "C", 4: "G"}


def test_midi_follows_the_grid():
    c = chart(bpm=100, hits=[hit(1.0, "kick"), hit(1.6, "snare")])
    mid = to_midi(c, derive(c))
    assert [m.tempo for m in mid.tracks[0] if m.type == "set_tempo"][0] == pytest.approx(600000, abs=300)
    notes = [m for m in mid.tracks[1] if m.type == "note_on"]
    assert [n.note for n in notes] == [36, 38] and all(n.channel == 9 for n in notes)


def test_lrc_round_trip():
    lines = parse_lrc("[00:12.50] Hello\n[01:02.03]World\nnot a line\n[00:01.00][00:05.00] Twice")
    assert [(l["t"], l["text"]) for l in lines] == [(1.0, "Twice"), (5.0, "Twice"), (12.5, "Hello"), (62.03, "World")]
    assert parse_lrc(to_lrc(lines)) == lines


def test_lyric_offset_is_found_from_the_vocal_stem():
    import numpy as np

    sr = 8000
    starts = [5.0, 9.0, 14.0, 18.5, 24.0, 29.0]          # where singing really starts
    audio = np.zeros(sr * 40, dtype=np.float32)
    rng = np.random.default_rng(0)
    for s in starts:
        audio[int(s * sr):int((s + 2.5) * sr)] = rng.normal(0, 0.3, int(2.5 * sr))
    lines = [{"t": s - 3.2, "text": "la"} for s in starts]  # lyrics timed 3.2 s early
    offset, gain = align_offset(lines, audio, sr)
    assert offset == pytest.approx(3.2, abs=0.15) and gain > 0.3


def test_title_cleanup():
    assert clean_title("Olivia Dean - A Couple Minutes (Official Video)") == ("Olivia Dean", "A Couple Minutes")
    assert clean_title("Some Song [Lyric Video]") == ("", "Some Song")
    assert is_url("https://youtu.be/abc") and not is_url("rm -rf /")
