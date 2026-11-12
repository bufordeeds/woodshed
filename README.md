# Woodshed

A private practice room for you and your friends. Give it a song; it splits the recording into
vocals / drums / bass / everything else and drafts a **drum chart**, the **chords** and the **lyrics**.
Then:

- **Drums** — read real notation with a moving cursor, play along on an e-kit over MIDI, and get scored note by note.
- **Singing** — mute the vocals and follow the lyrics, karaoke style.
- **Keys / guitar** — follow the chord changes; a MIDI keyboard lights up which of your notes fit the chord.
- **Fix it** — the draft is never perfect, so every part is editable: bar lines, drum hits, chords, lyrics.

Everything runs on your own computer. Nothing is uploaded; the only thing sent out is the song's
title and artist, to look up lyrics.

## Start

Needs macOS or Linux with [Homebrew](https://brew.sh)-style tools:

```bash
brew install ffmpeg node uv        # once
./run.sh                           # then open http://127.0.0.1:8000
```

The first run installs the Python packages and builds the interface (several minutes). The first
import also downloads the models (~500 MB). After that it starts in seconds.

Use Chrome, Edge or Firefox — Safari has no Web MIDI.
`./run.sh --host 0.0.0.0` lets other devices on your Wi-Fi open it too (instruments must be plugged
into the machine whose browser is showing the page).

## Using it

1. **Add a song** — paste a YouTube link or choose an audio file. Fill in title and artist if you
   can: that is what finds the lyrics. A 4-minute song takes very roughly 2 minutes on a laptop.
2. **Play** — Space starts and stops.
   - *Mix*: `Karaoke` drops the vocals, `No drums` drops the drums, `Band practice` drops both.
   - *Speed* 50–100 % without changing pitch. *Click* follows the song's real tempo.
   - *Loop*: drag across bars on the chart (or type bar numbers). *Count-in* gives one bar of clicks first.
   - *Drums*: plug the kit in over USB and just play. Hit noteheads turn green (on time), amber
     (early/late) or red (missed). Scoring wakes up on your first hit and stands down after 10 s of silence,
     so a karaoke night does not paint the chart red.
   - No kit nearby? The computer keyboard is a tiny kit: **X** kick, **S** snare, **H** hi-hat, **T** tom, **C** cymbal.
3. **Instruments** (button, top right) — shows what is connected, lets you re-map a pad by hitting it,
   and holds the timing offset. If you are told you are "38 ms late on average", press *Use as my offset* once:
   that is your gear's delay, not you.
4. **Edit** — work left to right:
   1. *Bars & tempo* — turn the click on; the high click must land on beat 1. Move the bar line, halve or
      double the tempo, set beats per bar, or switch between straight and triplet (6/8, 12/8) feel.
   2. *Drums* — one lane per drum over the drum stem's waveform. Click to add, drag to move, Delete to remove.
      Faint dots are hits the model was unsure about; *Next unsure hit* walks through them.
      *Tick on every charted note* lets you check by ear.
   3. *Chords* — one box per bar, one field per beat.
   4. *Lyrics* — timed lines; shift the whole song earlier/later, or stamp a line with the current time.

   Nothing is saved until you press **Save**. *Start over from the draft* returns to the first automatic version.

## Where things live

```
library/<song>/          one folder per song — copy it to share a song, delete it to remove one
    chart.json           the chart you edit (beats, meter, drum hits, chords, lyrics)
    chart.draft.json     the untouched first draft
    stems/*.flac         vocals, drums, bass, other
    original.*           what you imported
woodshed/                Python: import pipeline, bar grid, notation, server
frontend/                the interface (React + TypeScript); src/lib/player.ts is the audio engine
tests/                   pytest unit + API tests; tests/e2e browser checks
```

`WOODSHED_LIBRARY=/some/path ./run.sh` keeps the library somewhere else.
`WOODSHED_DEVICE=cpu|mps|cuda` forces where stem separation runs (default: fastest available).

From a terminal, without the app: `.venv/bin/woodshed import song.mp3 --title "…" --artist "…"`.

## How the draft is made

| Part | How | Expect |
|---|---|---|
| Stems | Demucs `htdemucs` | Good. Slight bleed between stems. |
| Drum hits | ADTOF on the drum stem (kick, snare, hi-hat, one "tom", one "cymbal") | Solid on rock/pop, weak on jazz, brushes and ghost notes. ~0.84 F1 on a 23-song real-music benchmark. You can split toms and cymbals into specific drums in the editor. |
| Beats, bar lines | Beat This! | Usually right; sometimes off by a beat or at half/double tempo — that is what *Bars & tempo* is for. |
| Chords | Chroma + templates, written for this project | Plain major/minor only, a draft to correct. Matches the known chords on the test songs; **not measured on real music.** |
| Lyrics | LRCLIB synced lyrics, auto-shifted to the vocals; Whisper on the vocal stem if the song is unknown | Line-level timing. Whisper mishears sung words. |

Model licences: ADTOF is CC BY-NC-SA (non-commercial) — fine for private use, not for a product.

## What has and has not been tested

Checked automatically (see `tests/`):

- 18 unit/API tests: bar grid incl. 6/8 and 12/8, meter overrides, notation structure, chord placement,
  lyric parsing and offset finding, save / preview / revert, bad input.
- `tests/e2e/ui.cjs` — headless Chromium against the running app: import with progress, playback at
  100 % and 50 %, mixer presets, a simulated MIDI drummer (perfect → 100 %, skipping notes → misses,
  60 ms late → "good" then "perfect" after applying the offset, extra hits), nothing marked missed when
  nobody drums, keyboard-note feedback, pad re-mapping, every editor tab, save, reload, revert, delete, downloads.
- `tests/e2e/engine.cjs` — the player's samples: one stem is a bit-exact copy, two stems an exact sum,
  loop wrap is sample-exact, 50 % / 75 % are exactly 1/speed long at the same pitch, click and ticks land
  within 0.03 ms, count-in is exactly one bar.

**Not** tested — you are the first:

- **Nobody has listened to it.** All audio checks were numeric, with no sound device.
- **No real hardware.** MIDI was simulated; the Alesis pad map is the General MIDI standard from memory.
  If a pad scores as the wrong drum, fix it in *Instruments*.
- **YouTube import never completed in development** (the build machine was refused as a bot). The code path
  and its error message were exercised; a real download was not.
- **Apple-silicon speed-up (MPS)** could not be run; it falls back to CPU by itself if it fails.
- **Real songs with real lyrics end to end.** Lyric lookup was checked for the songs asked about (both found),
  but never against their actual audio.
- Safari, phones, more than one screen.

## Known weak spots

- One time signature and one feel per song. Songs that change metre will have stretches that read wrong.
- Each beat is 16ths or triplets (8ths or 16ths in 6/8); faster figures snap to the nearest slot. No flams, rolls, dynamics or repeats.
- Slowed-down audio keeps drum hits crisp but sustained instruments get grainy at 50–70 %.
- The audio engine runs on the page's main thread; a very busy page can glitch it.
- A 5-minute song holds ~400 MB of audio in the browser tab.
- Keyboard players get chords and note feedback, not a written part or a score.
- The singer is not pitch-scored.
