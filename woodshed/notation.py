"""Derived chart -> MusicXML (percussion clef, chord symbols above) and MIDI.

Every notated note carries the id of the derived note it came from (`n12`), so
the browser can colour that exact notehead when it is hit or missed.
"""
from __future__ import annotations

import re
from pathlib import Path
from xml.sax.saxutils import escape

import mido
import numpy as np

from .grid import flat_beats
from .kit import DRUMS, GM_NOTE, NOTATION

DIV = 12  # divisions per quarter note

# slot length -> (note type, dots) for each kind of beat; value = divisions per slot
_TABLES = {
    ("straight", 4): (3, {1: ("16th", 0), 2: ("eighth", 0), 3: ("eighth", 1), 4: ("quarter", 0)}),
    ("straight", 3): (4, {1: ("eighth", 0), 2: ("quarter", 0)}),                       # triplet
    ("compound", 3): (6, {1: ("eighth", 0), 2: ("quarter", 0), 3: ("quarter", 1)}),
    ("compound", 6): (3, {1: ("16th", 0), 2: ("eighth", 0), 3: ("eighth", 1), 4: ("quarter", 0), 6: ("quarter", 1)}),
}

_KINDS = [  # suffix -> (MusicXML kind, text shown)
    ("maj7", "major-seventh", "maj7"), ("m7", "minor-seventh", "m7"), ("min7", "minor-seventh", "m7"),
    ("dim", "diminished", "dim"), ("aug", "augmented", "+"), ("sus4", "suspended-fourth", "sus4"),
    ("sus2", "suspended-second", "sus2"), ("7", "dominant", "7"), ("min", "minor", "m"), ("m", "minor", "m"),
    ("", "major", ""),
]


def _inst(d: str) -> str:
    return f"P1-I{GM_NOTE[d] + 1}"


def _harmony(name: str) -> str:
    m = re.match(r"^([A-G])([#b]?)(.*)$", name.strip())
    if not m:
        return ""
    step, acc, rest = m.groups()
    rest = rest.split("/")[0]
    kind, text = "major", rest
    for suffix, k, shown in _KINDS:
        if rest == suffix:
            kind, text = k, shown
            break
    alter = f"<root-alter>{1 if acc == '#' else -1}</root-alter>" if acc else ""
    return (f"<harmony><root><root-step>{step}</root-step>{alter}</root>"
            f'<kind text="{escape(text)}">{kind}</kind></harmony>')


def _note(group: list[dict] | None, dur: int, typ: str, dots: int, *, tm: bool, beam: str | None, tup: str | None) -> str:
    tmx = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" if tm else ""
    nt = f'<notations><tuplet type="{tup}" bracket="yes"/></notations>' if tup else ""
    if group is None:
        return f"<note><rest/><duration>{dur}</duration><voice>1</voice><type>{typ}</type>{'<dot/>' * dots}{tmx}{nt}</note>"
    out = []
    for i, n in enumerate(sorted(group, key=lambda n: DRUMS.index(n["d"]))):
        look = NOTATION[n["d"]]
        head = f"<notehead>{look['head']}</notehead>" if look["head"] else ""
        bm = f'<beam number="1">{beam}</beam>' if beam and i == 0 else ""
        out.append(
            f'<note id="{n["id"]}">' + ("<chord/>" if i else "") +
            f"<unpitched><display-step>{look['step']}</display-step><display-octave>{look['octave']}</display-octave></unpitched>"
            f"<duration>{dur}</duration><instrument id=\"{_inst(n['d'])}\"/><voice>1</voice><type>{typ}</type>"
            f"{'<dot/>' * dots}{tmx}<stem>up</stem>{head}{bm}{nt if i == 0 else ''}</note>")
    return "".join(out)


def _split(length: int, allowed: dict) -> list[int]:
    """Greedy split of a length (in slots) into representable lengths."""
    out = []
    while length > 0:
        take = max(a for a in allowed if a <= length)
        out.append(take)
        length -= take
    return out


def _beat_xml(compound: bool, div: int, by_slot: dict[int, list[dict]]) -> str:
    beat_div = 18 if compound else 12
    if not by_slot:
        return _note(None, beat_div, "quarter", 1 if compound else 0, tm=False, beam=None, tup=None)
    unit, table = _TABLES[("compound" if compound else "straight", div)]
    triplet = not compound and div == 3
    onsets = sorted(by_slot)
    events: list[tuple[list[dict] | None, int]] = []
    if onsets[0] > 0:
        events += [(None, ln) for ln in _split(onsets[0], table)]
    for i, s in enumerate(onsets):
        gap = (onsets[i + 1] if i + 1 < len(onsets) else div) - s
        parts = _split(gap, table)
        events.append((by_slot[s], parts[0]))
        events += [(None, ln) for ln in parts[1:]]

    # beams: runs of two or more consecutive notes shorter than a quarter
    beams: list[str | None] = [None] * len(events)
    run: list[int] = []

    def close():
        if len(run) >= 2:
            for j, idx in enumerate(run):
                beams[idx] = "begin" if j == 0 else "end" if j == len(run) - 1 else "continue"
        run.clear()

    for i, (grp, ln) in enumerate(events):
        if grp is not None and table[ln][0] in ("16th", "eighth"):
            run.append(i)
        else:
            close()
    close()

    out = []
    for i, (grp, ln) in enumerate(events):
        typ, dots = table[ln]
        tup = ("start" if i == 0 else "stop" if i == len(events) - 1 else None) if triplet and len(events) > 1 else None
        out.append(_note(grp, ln * unit, typ, dots, tm=triplet, beam=beams[i], tup=tup))
    return "".join(out)


def chord_beats(chart: dict, derived: dict) -> dict[int, str]:
    """Chord changes snapped to grid beats: {global beat index: name}."""
    g = flat_beats(derived["bars"])
    out: dict[int, str] = {}
    last = None
    for c in sorted(chart.get("chords") or [], key=lambda c: c["t"]):
        name = (c.get("name") or "").strip()
        k = int(np.argmin(np.abs(g[:-1] - c["t"])))
        if not name or name == "N":
            last = None
            continue
        if name != last or k not in out:
            out[k] = name
        last = name
    # drop repeats of the same chord on consecutive changes
    cleaned, prev = {}, None
    for k in sorted(out):
        if out[k] != prev:
            cleaned[k] = out[k]
        prev = out[k]
    return cleaned


def to_musicxml(chart: dict, derived: dict) -> str:
    bars, per_bar, compound = derived["bars"], derived["per_bar"], derived["compound"]
    beat_div = 18 if compound else 12
    title = chart.get("title") or "Untitled"
    used = sorted({n["d"] for n in derived["notes"] if n["d"] in NOTATION} or {"snare"}, key=DRUMS.index)
    cells: dict[int, dict[int, list[dict]]] = {}
    for n in derived["notes"]:
        if n["d"] in NOTATION:
            cells.setdefault((n["bar"] - 1) * per_bar + n["beat"], {}).setdefault(n["slot"], []).append(n)
    chords = chord_beats(chart, derived)
    num, den = derived["time_signature"]

    x = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
         '<score-partwise version="4.0">',
         f"<work><work-title>{escape(title)}</work-title></work>",
         "<identification><encoding><software>Woodshed</software></encoding></identification>",
         '<part-list><score-part id="P1"><part-name>Drums</part-name>']
    x += [f'<score-instrument id="{_inst(d)}"><instrument-name>{NOTATION[d]["name"]}</instrument-name></score-instrument>' for d in used]
    x += [f'<midi-instrument id="{_inst(d)}"><midi-channel>10</midi-channel><midi-program>1</midi-program>'
          f"<midi-unpitched>{GM_NOTE[d] + 1}</midi-unpitched></midi-instrument>" for d in used]
    x.append('</score-part></part-list><part id="P1">')
    for bar in bars:
        n = bar["n"]
        first = (n - 1) * per_bar
        x.append(f'<measure number="{n}" id="m{n}">')
        if n == 1:
            bpm = int(round(derived["tempo_bpm"]))
            dot = "<beat-unit-dot/>" if compound else ""
            x.append(f"<attributes><divisions>{DIV}</divisions><key><fifths>0</fifths></key>"
                     f"<time><beats>{num}</beats><beat-type>{den}</beat-type></time>"
                     "<clef><sign>percussion</sign><line>2</line></clef></attributes>"
                     f'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>{dot}'
                     f"<per-minute>{bpm}</per-minute></metronome></direction-type>"
                     f'<sound tempo="{bpm * (1.5 if compound else 1):.0f}"/></direction>')
        has_notes = any(first + b in cells for b in range(per_bar))
        mid_chords = any(first + b in chords for b in range(1, per_bar))
        if not has_notes and not mid_chords:
            x.append(_harmony(chords[first]) if first in chords else "")
            x.append(f'<note><rest measure="yes"/><duration>{beat_div * per_bar}</duration><voice>1</voice></note>')
        else:
            for b in range(per_bar):
                k = first + b
                if k in chords:
                    x.append(_harmony(chords[k]))
                x.append(_beat_xml(compound, derived["divs"].get(k, 3 if compound else 4), cells.get(k, {})))
        if n == len(bars):
            x.append('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
        x.append("</measure>")
    x.append("</part></score-partwise>")
    return "\n".join(s for s in x if s) + "\n"


def to_midi(chart: dict, derived: dict, quantized: bool = False) -> mido.MidiFile:
    """MIDI whose tempo map follows the detected beats; bar 1 of the file is bar 1 of the chart."""
    ppq = 480
    per_beat = int(ppq * derived["qpb"])
    g = flat_beats(derived["bars"])
    mid = mido.MidiFile(ticks_per_beat=ppq)
    meta, drums = mido.MidiTrack(), mido.MidiTrack()
    mid.tracks += [meta, drums]
    num, den = derived["time_signature"]
    meta.append(mido.MetaMessage("time_signature", numerator=num, denominator=den, time=0))
    last, pending = None, 0
    for k in range(len(g) - 1):
        tempo = int(np.clip(round((g[k + 1] - g[k]) / derived["qpb"] * 1e6), 1, 0xFFFFFF))
        if tempo != last:
            meta.append(mido.MetaMessage("set_tempo", tempo=tempo, time=pending))
            pending, last = 0, tempo
        pending += per_beat
    events = []
    for n in derived["notes"]:
        t = n["tq"] if quantized else n["t"]
        k = int(np.clip(np.searchsorted(g, t, side="right") - 1, 0, len(g) - 2))
        tick = max(0, int(round((k + (t - g[k]) / (g[k + 1] - g[k])) * per_beat)))
        events += [(tick, 1, "note_on", GM_NOTE[n["d"]], int(np.clip(n["v"], 1, 127))),
                   (tick + 60, 0, "note_off", GM_NOTE[n["d"]], 0)]
    now = 0
    for tick, _, kind, note, vel in sorted(events, key=lambda e: (e[0], e[1])):
        drums.append(mido.Message(kind, channel=9, note=note, velocity=vel, time=tick - now))
        now = tick
    return mid


def write_midi(chart: dict, derived: dict, path: str | Path) -> None:
    to_midi(chart, derived).save(str(path))
