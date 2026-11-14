"""Bar grid + quantization: turns the chart (beats, hits, meter settings) into bars and notated notes.

The chart keeps what was detected or edited (beat times, hit times). Everything
here is *derived* on demand and never written back, so editing a hit time or a
meter setting simply re-flows the notation.

Meter settings (chart["meter"], all optional):
    tempo:          "normal" | "half" | "double" | "thirds"  - re-read the tracked beats
    beats_per_bar:  int or None (None = from detected downbeats)
    shift:          int, move the bar line by this many beats
    feel:           "auto" | "straight" | "compound"          - beat = quarter, or dotted quarter (6/8, 12/8)
    offset_s:       float, nudge the whole grid
"""
from __future__ import annotations

from collections import Counter

import numpy as np

from .kit import FAMILY

_ROLLOVER = 0.875  # hits later than this fraction of a beat belong to the next beat


def _clean(beats, duration: float) -> np.ndarray:
    b = np.unique(np.asarray(beats, dtype=float))
    b = b[np.isfinite(b)]
    if len(b) >= 2:
        b = b[np.concatenate([[True], np.diff(b) > 0.1])]
    if len(b) < 2:
        return np.arange(0.0, max(duration, 2.0) + 0.5, 0.5)  # no beat tracking: 120 BPM fallback
    med = float(np.median(np.diff(b)))
    out = [b[0]]
    for nxt in b[1:]:
        prev = out[-1]
        n = int(round((nxt - prev) / med))
        if n >= 2:  # the tracker skipped beats: fill the hole evenly
            step = (nxt - prev) / n
            out.extend([prev + step * i for i in range(1, n)])
        out.append(nxt)
    return np.asarray(out)


def _snap(beats: np.ndarray, hit_times: np.ndarray, tol: float = 0.035) -> np.ndarray:
    """Nudge each beat onto the drum hits played on it (the tracker has 20 ms resolution)."""
    if len(hit_times) == 0:
        return beats
    out = beats.copy()
    for i, b in enumerate(beats):
        lo, hi = np.searchsorted(hit_times, [b - tol, b + tol])
        if hi > lo:
            out[i] = hit_times[lo:hi].mean()
    return out


def _retime(beats: np.ndarray, mode: str, anchor: int) -> np.ndarray:
    if mode == "half":
        return beats[anchor % 2::2]
    if mode == "thirds":
        return beats[anchor % 3::3]
    if mode == "double":
        mids = (beats[:-1] + beats[1:]) / 2
        out = np.empty(len(beats) * 2 - 1)
        out[0::2], out[1::2] = beats, mids
        return out
    return beats


def _cost(fracs, div: int) -> float:
    return sum(min(abs(f - j / div) for j in range(div + 1)) for f in fracs)


def _locate(g: np.ndarray, times) -> list[tuple[int, float]]:
    """(beat index, fraction of beat) for every time, with late hits rolled into the next beat."""
    out = []
    for t in times:
        k = int(np.clip(np.searchsorted(g, t, side="right") - 1, 0, len(g) - 2))
        frac = (t - g[k]) / (g[k + 1] - g[k])
        if frac >= _ROLLOVER and k < len(g) - 2:
            k, frac = k + 1, 0.0
        out.append((k, float(np.clip(frac, 0.0, 0.999))))
    return out


def derive(chart: dict) -> dict:
    """Bars, meter and notated notes for a chart. Pure function of the chart."""
    meter = chart.get("meter") or {}
    hits = chart.get("drums") or []
    duration = float(chart.get("duration_s") or 0.0)
    times = np.asarray([h["t"] for h in hits], dtype=float)
    confident = np.sort(np.asarray([h["t"] for h in hits if h.get("c", 1.0) >= 0.4], dtype=float))
    notes_auto = []

    raw = _clean(chart.get("beats") or [], duration)
    downbeats = np.asarray(chart.get("downbeats") or [], dtype=float)

    def meter_of(b: np.ndarray) -> tuple[int, int]:
        if len(downbeats) == 0:
            return 4, 0
        idx = np.array([int(np.argmin(np.abs(b - t))) for t in downbeats])
        spans = [int(s) for s in np.diff(idx) if 2 <= s <= 12]
        per = Counter(spans).most_common(1)[0][0] if spans else 4
        return per, Counter(int(i % per) for i in idx).most_common(1)[0][0]

    tempo_mode = meter.get("tempo") or "normal"
    feel = meter.get("feel") or "auto"
    per_bar, phase = meter_of(raw)
    if tempo_mode == "normal" and feel == "auto" and not meter.get("beats_per_bar") and per_bar in (6, 12):
        # the tracker is counting eighth notes of a 6/8 or 12/8: read the pulse as dotted quarters
        tempo_mode, feel = "thirds", "compound"
        notes_auto.append("beats grouped in threes (compound time)")
    g = _retime(raw, tempo_mode, phase)
    g = _snap(g, confident) + float(meter.get("offset_s") or 0.0)
    if tempo_mode != "normal":
        per_bar, phase = meter_of(g)
    if meter.get("beats_per_bar"):
        per_bar = int(meter["beats_per_bar"])
    phase = (phase + int(meter.get("shift") or 0)) % per_bar

    # extend so every hit sits in a whole bar
    g = list(g)
    t_min = min(g[0], times.min()) if len(times) else g[0]
    t_max = max(g[-1], times.max()) if len(times) else g[-1]
    head, tail = g[1] - g[0], g[-1] - g[-2]
    while g[0] > t_min + 1e-6 or phase % per_bar != 0:
        g.insert(0, g[0] - head)
        phase = (phase + 1) % per_bar
    while g[-1] <= t_max + tail * (1 - _ROLLOVER) or (len(g) - 1) % per_bar != 0:
        g.append(g[-1] + tail)
    g = np.asarray(g)

    located = _locate(g, times)
    per_beat: dict[int, list[int]] = {}
    for i, (k, _) in enumerate(located):
        per_beat.setdefault(k, []).append(i)

    # straight (beat = quarter) or compound (beat = dotted quarter)?
    if feel == "auto":
        tri = total = 0
        for k, idxs in per_beat.items():
            fr = [located[i][1] for i in idxs if located[i][1] > 0.12]
            if fr:
                total += 1
                tri += _cost(fr, 3) < 0.7 * _cost(fr, 4)
        compound = total >= 8 and tri >= 0.6 * total
    else:
        compound = feel == "compound"

    # subdivision per beat: straight = 16ths (4) or triplets (3); compound = 8ths (3) or 16ths (6)
    base, alt = (3, 6) if compound else (4, 3)
    bar_cost: dict[int, list[float]] = {}
    for k, idxs in per_beat.items():
        fr = [located[i][1] for i in idxs]
        c = bar_cost.setdefault(k // per_bar, [0.0, 0.0])
        c[0] += _cost(fr, base)
        c[1] += _cost(fr, alt)
    divs = {}
    for k, idxs in per_beat.items():
        fr = [located[i][1] for i in idxs]
        own_b, own_a = _cost(fr, base), _cost(fr, alt)
        n_off = sum(1 for f in fr if f > 0.1)
        if compound:
            # 16ths only when the 8th grid clearly does not fit
            divs[k] = alt if own_a + 0.03 * n_off < 0.5 * own_b else base
        else:
            cb, ca = bar_cost[k // per_bar]
            d = alt if ca < 0.6 * cb else base
            if d == base and own_a + 0.02 * n_off < 0.5 * own_b:
                d = alt
            elif d == alt and own_b + 0.02 * n_off < 0.5 * own_a:
                d = base
            divs[k] = d

    # notes: hits that land on the same slot with the same drum are one notated note
    slots: dict[tuple[int, int, str], dict] = {}
    for k, idxs in per_beat.items():
        div = divs[k]
        ss = [min(int(round(located[i][1] * div)), div - 1) for i in idxs]
        if not compound and div == 3 and not any(ss):
            div = 4
        if compound and div == 6 and not any(s % 2 for s in ss):
            div, ss = 3, [s // 2 for s in ss]
        divs[k] = div
        for i, s in zip(idxs, ss):
            n = slots.setdefault((k, s, hits[i]["d"]), {"k": k, "slot": s, "div": div, "d": hits[i]["d"], "hits": []})
            n["hits"].append(i)
    notes = []
    for j, n in enumerate(sorted(slots.values(), key=lambda n: (n["k"], n["slot"], n["d"]))):
        k = n["k"]
        t_grid = g[k] + (g[k + 1] - g[k]) * n["slot"] / n["div"]
        notes.append({
            "id": f"n{j}", "d": n["d"], "family": FAMILY.get(n["d"], n["d"]),
            "t": round(float(np.mean([hits[i]["t"] for i in n["hits"]])), 4),   # when it was played
            "tq": round(float(t_grid), 4),                                       # where the grid puts it
            "v": max(hits[i].get("v", 100) for i in n["hits"]),
            "c": round(max(hits[i].get("c", 1.0) for i in n["hits"]), 3),
            "bar": k // per_bar + 1, "beat": k % per_bar, "slot": n["slot"], "div": n["div"], "hits": n["hits"],
        })

    bars = []
    for i in range((len(g) - 1) // per_bar):
        seg = g[i * per_bar:(i + 1) * per_bar + 1]
        bars.append({"n": i + 1, "t0": round(float(seg[0]), 4), "t1": round(float(seg[-1]), 4),
                     "beats": [round(float(x), 4) for x in seg[:-1]]})
    bpm = 60.0 / float(np.median(np.diff(g)))
    return {
        "bars": bars, "per_bar": per_bar, "compound": bool(compound),
        "qpb": 1.5 if compound else 1.0,                      # quarter notes per beat
        "time_signature": [per_bar * 3, 8] if compound else [per_bar, 4],
        "tempo_bpm": round(bpm, 1),
        "notes": notes, "divs": {int(k): int(v) for k, v in divs.items()},
        "auto": notes_auto,
    }


def flat_beats(bars: list[dict]) -> np.ndarray:
    return np.asarray([b for bar in bars for b in bar["beats"]] + [bars[-1]["t1"]])
