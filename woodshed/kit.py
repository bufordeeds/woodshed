"""Drum vocabulary: chart classes, how they are notated, and how MIDI pads map onto them."""

# Chart classes, low -> high on the staff. The transcription model only emits
# kick / snare / tom / hihat / cymbal; the rest exist so a chart can be refined by hand.
DRUMS = ["kick", "tom3", "snare", "tom", "tom2", "tom1", "ride", "hihat", "hihat_open", "cymbal", "crash"]

# For scoring, a pad hit counts if it is in the same family as the charted note.
FAMILY = {
    "kick": "kick", "snare": "snare",
    "tom": "tom", "tom1": "tom", "tom2": "tom", "tom3": "tom",
    "hihat": "hihat", "hihat_open": "hihat",
    "cymbal": "cymbal", "crash": "cymbal", "ride": "cymbal",
}
FAMILIES = ["kick", "snare", "hihat", "tom", "cymbal"]

# ADTOF label (the MIDI pitch it emits) -> chart class
ADTOF_LABELS = {35: "kick", 38: "snare", 47: "tom", 42: "hihat", 49: "cymbal"}

GM_NOTE = {"kick": 36, "snare": 38, "tom": 47, "tom1": 48, "tom2": 45, "tom3": 43,
           "hihat": 42, "hihat_open": 46, "cymbal": 49, "crash": 49, "ride": 51}

# Staff position (as if treble clef) + notehead
NOTATION = {
    "kick":       {"step": "F", "octave": 4, "head": None, "name": "Kick"},
    "tom3":       {"step": "A", "octave": 4, "head": None, "name": "Floor Tom"},
    "snare":      {"step": "C", "octave": 5, "head": None, "name": "Snare"},
    "tom":        {"step": "D", "octave": 5, "head": None, "name": "Tom"},
    "tom2":       {"step": "D", "octave": 5, "head": None, "name": "Mid Tom"},
    "tom1":       {"step": "E", "octave": 5, "head": None, "name": "High Tom"},
    "ride":       {"step": "F", "octave": 5, "head": "x", "name": "Ride"},
    "hihat":      {"step": "G", "octave": 5, "head": "x", "name": "Hi-Hat"},
    "hihat_open": {"step": "G", "octave": 5, "head": "circle-x", "name": "Open Hi-Hat"},
    "cymbal":     {"step": "A", "octave": 5, "head": "x", "name": "Cymbal"},
    "crash":      {"step": "A", "octave": 5, "head": "x", "name": "Crash"},
}

# Default pad map: General MIDI percussion, which is what Alesis (Nitro family included), Roland and
# Yamaha modules send out of the box. `None` = ignore for scoring (hi-hat foot chick).
# NOTE: written from the GM standard, not verified against a physical Nitro Max — the app has a
# "hit a pad to learn it" screen for anything that differs.
DEFAULT_PAD_MAP = {
    35: "kick", 36: "kick",
    37: "snare", 38: "snare", 39: "snare", 40: "snare",
    41: "tom", 43: "tom", 45: "tom", 47: "tom", 48: "tom", 50: "tom", 58: "tom",
    42: "hihat", 46: "hihat", 22: "hihat", 26: "hihat", 23: "hihat", 21: "hihat",
    44: None,
    49: "cymbal", 57: "cymbal", 55: "cymbal", 52: "cymbal", 51: "cymbal", 53: "cymbal", 59: "cymbal",
}
