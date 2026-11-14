import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, STEMS, type Chart, type ChartBundle, type Derived, type Kit, type Song } from '../lib/api'
import { Judge } from '../lib/judge'
import { midi } from '../lib/midi'
import { PlayerEngine, loadAudio } from '../lib/player'
import { loadSettings, saveSettings, type Settings } from '../lib/settings'
import { Grid, formatTime } from '../lib/timing'
import ChordEditor from '../components/ChordEditor'
import ChordStrip from '../components/ChordStrip'
import LaneEditor from '../components/LaneEditor'
import LyricsEditor from '../components/LyricsEditor'
import LyricsPanel from '../components/LyricsPanel'
import Mixer, { FULL, type Gains } from '../components/Mixer'
import Score, { type ScoreHandle } from '../components/Score'
import SettingsDialog from '../components/SettingsDialog'
import TempoPanel from '../components/TempoPanel'
import Transport, { btn, off, on } from '../components/Transport'

const STAGES: Record<string, string> = {
  queued: 'Waiting…',
  starting: 'Starting…',
  downloading: 'Fetching the audio…',
  reading_audio: 'Reading the audio…',
  separating_stems: 'Splitting into vocals, drums, bass and the rest — the slow step…',
  finding_drum_hits: 'Finding drum hits…',
  finding_beats: 'Finding beats and bar lines…',
  finding_chords: 'Working out the chords…',
  finding_lyrics: 'Looking up lyrics…',
  transcribing_lyrics: 'No lyrics found online — listening to the vocals instead…',
  saving: 'Saving…',
}

type EditTab = 'bars' | 'drums' | 'chords' | 'lyrics'

export default function SongPage({ songId }: { songId: string }) {
  const [song, setSong] = useState<Song | null>(null)
  const [error, setError] = useState<string | null>(null)

  // poll until the import is done
  useEffect(() => {
    let cancelled = false
    let timer = 0
    setSong(null)
    setError(null)
    const poll = async () => {
      try {
        const s = await api.song(songId)
        if (cancelled) return
        setSong(s)
        if (s.status === 'queued' || s.status === 'processing') timer = window.setTimeout(poll, 1000)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [songId])

  if (error) return <div className="max-w-xl mx-auto bg-red-50 border border-red-200 rounded-lg p-4 text-red-800" data-testid="song-error">{error}. <a className="underline" href="#/">Back to the library</a></div>
  if (!song) return <p className="text-stone-500">Loading…</p>
  if (song.status === 'error') {
    return (
      <div className="max-w-xl mx-auto bg-red-50 border border-red-200 rounded-lg p-4" data-testid="song-error">
        <h2 className="font-medium text-red-800">Import failed</h2>
        <p className="mt-1 text-sm text-red-700">{song.error || 'Unknown error'}</p>
        <a className="mt-3 inline-block text-sm underline text-red-800" href="#/">Back to the library</a>
      </div>
    )
  }
  if (song.status !== 'ready') {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-lg border border-stone-200 p-6" data-testid="processing">
        <h2 className="text-lg font-medium text-stone-900 break-words">{song.title}{song.artist && <span className="text-stone-500"> — {song.artist}</span>}</h2>
        <p className="mt-1 text-sm text-stone-600" data-testid="stage">{STAGES[song.stage] ?? 'Working…'}</p>
        <div className="mt-4 h-2 bg-stone-200 rounded-full overflow-hidden">
          <div className="h-full bg-amber-700 transition-all duration-700" style={{ width: `${Math.max(2, song.progress)}%` }} />
        </div>
        <p className="mt-2 text-xs text-stone-500 tabular-nums" data-testid="progress">{song.progress}%</p>
        <p className="mt-4 text-xs text-stone-500">Roughly half the song's length on a recent laptop. The first import also downloads the models.</p>
      </div>
    )
  }
  return <Room songId={songId} />
}

/** A ready song: one player shared by the Play and Edit views. */
function Room({ songId }: { songId: string }) {
  const [saved, setSaved] = useState<ChartBundle | null>(null)
  const [work, setWork] = useState<Chart | null>(null)
  const [derived, setDerived] = useState<Derived | null>(null)
  const [xml, setXml] = useState('')
  const [kit, setKit] = useState<Kit | null>(null)
  const [peaks, setPeaks] = useState<{ per_second: number; drums: number[] }>({ per_second: 100, drums: [] })
  const [engine, setEngine] = useState<PlayerEngine | null>(null)
  const [audioState, setAudioState] = useState('Loading audio…')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [mode, setMode] = useState<'play' | 'edit'>('play')
  const [tab, setTab] = useState<EditTab>('bars')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(100)
  const [click, setClick] = useState(false)
  const [countIn, setCountIn] = useState(true)
  const [audition, setAudition] = useState(false)
  const [loop, setLoop] = useState<{ from: number; to: number } | null>(null)
  const [gains, setGains] = useState<Gains>(FULL)
  const [showLyrics, setShowLyrics] = useState(true)
  const [showChords, setShowChords] = useState(true)
  const [settings, setSettingsState] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [held, setHeld] = useState<number[]>([])
  const [hud, setHud] = useState({ perfect: 0, good: 0, miss: 0, stray: 0, combo: 0, best: 0, accuracy: 0, tendency: 0, last: '' })

  const scoreRef = useRef<ScoreHandle>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const tickers = useRef(new Set<(t: number) => void>())
  const subscribe = useCallback((fn: (t: number) => void) => {
    tickers.current.add(fn)
    return () => {
      tickers.current.delete(fn)
    }
  }, [])
  const undo = useRef<Chart[]>([])
  const judgeRef = useRef<Judge | null>(null)
  const sweepFrom = useRef(0)
  // Scoring arms itself on the first pad hit and stands down after 10 s without one,
  // so a karaoke night with nobody on the kit does not paint the chart red.
  const lastHit = useRef(-Infinity)

  const grid = useMemo(() => (derived ? new Grid(derived) : null), [derived])
  const dirty = !!saved && !!work && work !== saved.chart
  const setSettings = (s: Settings) => {
    setSettingsState(s)
    saveSettings(s)
  }

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    Promise.all([api.chart(songId), api.musicxml(songId), api.kit(), api.peaks(songId)])
      .then(([bundle, x, k, pk]) => {
        if (cancelled) return
        setSaved(bundle)
        setWork(bundle.chart)
        setDerived(bundle.derived)
        setXml(x)
        setKit(k)
        setPeaks(pk)
      })
      .catch((e) => !cancelled && setProblem(String(e.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [songId])

  useEffect(() => {
    let cancelled = false
    let created: PlayerEngine | null = null
    const ctx = new AudioContext()
    ;(async () => {
      try {
        const buffers = await Promise.all(STEMS.map((s) => loadAudio(ctx, api.stemUrl(songId, s))))
        if (cancelled) return
        created = new PlayerEngine(ctx, Object.fromEntries(STEMS.map((s, i) => [s, buffers[i]])))
        created.onEnded = () => setPlaying(false)
        ;(window as any).__engine = created // for debugging and the automated tests
        setEngine(created)
        setAudioState('')
      } catch (e) {
        if (!cancelled) setAudioState(`Audio failed to load: ${e instanceof Error ? e.message : e}`)
      }
    })()
    return () => {
      cancelled = true
      created?.destroy()
      ctx.close().catch(() => undefined)
    }
  }, [songId])

  // ---- editing ------------------------------------------------------------
  const previewTimer = useRef(0)
  const previewSeq = useRef(0)
  const edit = useCallback(
    (next: Chart) => {
      setWork((prev) => {
        if (prev) undo.current = [...undo.current.slice(-49), prev]
        return next
      })
      window.clearTimeout(previewTimer.current)
      const seq = ++previewSeq.current
      previewTimer.current = window.setTimeout(async () => {
        try {
          const res = await api.preview(songId, next)
          if (seq !== previewSeq.current) return
          setDerived(res.derived)
          setXml(res.musicxml)
          setProblem(null)
        } catch (e) {
          setProblem(e instanceof Error ? e.message : String(e))
        }
      }, 250)
    },
    [songId],
  )
  const undoLast = () => {
    const prev = undo.current.pop()
    if (!prev) return
    setWork(prev)
    const seq = ++previewSeq.current
    api.preview(songId, prev).then((res) => {
      if (seq !== previewSeq.current) return
      setDerived(res.derived)
      setXml(res.musicxml)
    })
  }
  const adopt = (bundle: ChartBundle, x: string) => {
    undo.current = []
    setSaved(bundle)
    setWork(bundle.chart)
    setDerived(bundle.derived)
    setXml(x)
  }
  const save = async () => {
    if (!work) return
    setSaving(true)
    try {
      window.clearTimeout(previewTimer.current)
      previewSeq.current++
      const bundle = await api.save(songId, work)
      adopt(bundle, await api.musicxml(songId))
      setProblem(null)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  const discard = async () => {
    if (!saved) return
    previewSeq.current++
    adopt(saved, await api.musicxml(songId))
  }
  const revert = async () => {
    if (!window.confirm('Throw away every edit and go back to the first automatic draft?')) return
    const bundle = await api.revert(songId)
    adopt(bundle, await api.musicxml(songId))
  }

  // ---- engine <- state ----------------------------------------------------
  useEffect(() => {
    if (!engine || !grid || !derived) return
    engine.setBeats(grid.clickBeats(), grid.perBar)
    engine.setOnsets(derived.notes.map((n) => n.t))
  }, [engine, grid, derived])
  useEffect(() => engine?.setSpeed(speed / 100), [engine, speed])
  useEffect(() => {
    if (engine) engine.clickEnabled = click
  }, [engine, click])
  useEffect(() => {
    if (engine) engine.countInEnabled = countIn
  }, [engine, countIn])
  useEffect(() => {
    if (engine) engine.auditionEnabled = audition && mode === 'edit'
  }, [engine, audition, mode])
  useEffect(() => {
    if (engine) STEMS.forEach((s) => engine.setGain(s, gains[s]))
  }, [engine, gains])
  useEffect(() => {
    if (!engine || !grid) return
    const safe = loop && loop.to <= grid.barCount ? loop : null
    engine.setLoop(safe ? { start: Math.max(0, grid.barStart(safe.from)), end: grid.barEnd(safe.to) } : null)
  }, [engine, grid, loop])
  useEffect(() => {
    midi().allChannelsAreDrums = settings.allChannelsAreDrums
  }, [settings.allChannelsAreDrums])

  // ---- scoring ------------------------------------------------------------
  const refreshHud = (last = '') => {
    const j = judgeRef.current
    if (!j) return
    setHud({ perfect: j.perfect, good: j.good, miss: j.miss, stray: j.stray, combo: j.combo, best: j.bestCombo, accuracy: j.accuracy, tendency: j.tendencyMs, last })
  }
  useEffect(() => {
    if (!derived) return
    judgeRef.current = new Judge(derived.notes)
    scoreRef.current?.clearMarks()
    refreshHud()
  }, [derived])
  const resetScore = () => {
    judgeRef.current?.reset()
    scoreRef.current?.clearMarks()
    sweepFrom.current = engine?.currentTime ?? 0
    refreshHud()
  }
  useEffect(() => {
    if (!engine) return
    engine.onJump = (t) => {
      // un-judge what is about to be played again
      judgeRef.current?.rewind(t).forEach((id) => scoreRef.current?.mark(id, null))
      sweepFrom.current = t
      if (judgeRef.current) judgeRef.current.floor = t
    }
    return () => {
      engine.onJump = undefined
    }
  }, [engine])
  /** Bring the judge up to "now": notice loop wraps, turn notes that went by unplayed into misses. */
  const advanceRef = useRef(() => {})
  advanceRef.current = () => {
    const judge = judgeRef.current
    if (!judge || !engine || !engine.playing || engine.countingIn) return
    const to = engine.timeAt(performance.now() - settings.latencyMs)
    if (performance.now() - lastHit.current > 10000) {
      sweepFrom.current = judge.floor = to // nobody is drumming: nothing is "missed"
      return
    }
    if (to < sweepFrom.current - 0.05) {
      // the loop came round: what is about to be played again is unjudged again
      judge.rewind(to).forEach((id) => scoreRef.current?.mark(id, null))
      sweepFrom.current = judge.floor = to
    } else if (to > sweepFrom.current) {
      const missed = judge.sweep(sweepFrom.current, to, engine.speed)
      sweepFrom.current = to
      if (missed.length) {
        missed.forEach((n) => scoreRef.current?.mark(n.id, 'miss'))
        refreshHud('miss')
      }
    }
  }
  useEffect(() => {
    if (!engine || !kit) return
    return midi().listen((e) => {
      if (e.kind === 'key') {
        setHeld((h) => (e.on ? [...new Set([...h, e.note])] : h.filter((n) => n !== e.note)))
        return
      }
      const key = String(e.note)
      const family = key in settings.padMap ? settings.padMap[key] : kit.pad_map[key]
      const judge = judgeRef.current
      if (!family || !judge || mode !== 'play' || !engine.playing || engine.countingIn) return
      const idle = performance.now() - lastHit.current > 10000
      lastHit.current = performance.now()
      if (idle) {
        // first hit after a pause: start judging from just before this hit
        const at = engine.timeAt(e.time - settings.latencyMs) - 0.12 * engine.speed
        sweepFrom.current = judge.floor = at
      }
      advanceRef.current() // so a hit just after a loop wrap is judged against the new pass
      const res = judge.hit(family, engine.timeAt(e.time - settings.latencyMs), engine.speed)
      if (res.note) scoreRef.current?.mark(res.note.id, res.verdict)
      refreshHud(res.verdict === 'stray' ? 'extra hit' : `${res.verdict} ${res.deltaMs! >= 0 ? '+' : ''}${Math.round(res.deltaMs!)} ms`)
    })
  }, [engine, kit, settings, mode])

  // ---- clock --------------------------------------------------------------
  useEffect(() => {
    if (!engine || !grid) return
    let raf = 0
    const tick = () => {
      const t = engine.currentTime
      scoreRef.current?.setCursor(grid.timeToQ(t), engine.playing && mode === 'play')
      if (timeRef.current) timeRef.current.textContent = `${formatTime(t)} / ${formatTime(engine.duration)}`
      if (barRef.current) barRef.current.textContent = engine.countingIn ? 'count-in' : `bar ${grid.barAt(t)}`
      tickers.current.forEach((fn) => fn(t))
      if (mode === 'play') advanceRef.current()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, grid, mode, settings.latencyMs])

  // ---- transport ----------------------------------------------------------
  const toggle = useCallback(async () => {
    if (!engine) return
    if (engine.playing) {
      engine.pause()
      setPlaying(false)
    } else {
      sweepFrom.current = engine.currentTime
      await engine.play()
      setPlaying(true)
    }
  }, [engine])
  const seekBar = useCallback(
    (bar: number) => {
      if (engine && grid) engine.seek(Math.max(0, grid.barStart(Math.min(Math.max(bar, 1), grid.barCount))))
    },
    [engine, grid],
  )
  const onBarClick = (bar: number, extend: boolean) => {
    if (!grid || !engine) return
    if (extend) {
      const anchor = loop ? loop.from : grid.barAt(engine.currentTime)
      setLoop({ from: Math.min(anchor, bar), to: Math.max(loop ? loop.to : anchor, bar) })
    } else {
      if (loop && (bar < loop.from || bar > loop.to)) setLoop(null)
      seekBar(bar)
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        void toggle()
      } else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && engine && grid) {
        e.preventDefault()
        seekBar(grid.barAt(engine.currentTime) + (e.code === 'ArrowRight' ? 1 : -1))
      } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && mode === 'edit') {
        e.preventDefault()
        undoLast()
      } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!saved || !work || !derived || !grid || !kit) {
    return problem ? <div className="p-4 bg-red-50 text-red-800 rounded-lg">Could not open this song: {problem}</div> : <p className="text-stone-500">Opening…</p>
  }

  const judgedTotal = hud.perfect + hud.good + hud.miss
  return (
    <div className="space-y-4" data-testid="room" data-mode={mode}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-stone-900 break-words" data-testid="song-title">
            {work.title}
            {work.artist && <span className="font-normal text-stone-500"> — {work.artist}</span>}
          </h2>
          <p className="text-sm text-stone-600" data-testid="summary">
            {derived.time_signature[0]}/{derived.time_signature[1]} · ~{Math.round(derived.tempo_bpm)} BPM · {derived.bars.length} bars · {derived.notes.length} drum notes
            {work.key && ` · key ${work.key}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex" role="tablist">
            <button className={`${btn} rounded-r-none ${mode === 'play' ? on : off}`} onClick={() => setMode('play')} data-testid="mode-play">Play</button>
            <button className={`${btn} rounded-l-none -ml-px ${mode === 'edit' ? on : off}`} onClick={() => setMode('edit')} data-testid="mode-edit">Edit</button>
          </div>
          <button className={`${btn} ${off}`} onClick={() => setShowSettings(true)} data-testid="open-settings">Instruments</button>
          <a className={`${btn} ${off}`} href={api.musicxmlUrl(songId)} data-testid="dl-musicxml">MusicXML</a>
          <a className={`${btn} ${off}`} href={api.midiUrl(songId)} data-testid="dl-midi">MIDI</a>
        </div>
      </div>

      <div className="sticky top-0 z-20 bg-stone-100/95 backdrop-blur py-2 space-y-2">
        <div className="bg-white border border-stone-200 rounded-lg shadow-sm px-3 py-2 space-y-2">
          <Transport
            ready={!!engine}
            playing={playing}
            onToggle={() => void toggle()}
            onRewind={() => engine && engine.seek(loop ? Math.max(0, grid.barStart(loop.from)) : 0)}
            timeRef={timeRef}
            barRef={barRef}
            speed={speed}
            setSpeed={setSpeed}
            click={click}
            setClick={setClick}
            loop={loop}
            setLoop={setLoop}
            barCount={grid.barCount}
            countIn={countIn}
            setCountIn={setCountIn}
          />
          <Mixer gains={gains} setGains={setGains} />
          {audioState && <span className="text-sm text-stone-500" data-testid="audio-state">{audioState}</span>}
        </div>
        {(dirty || problem) && (
          <div className={`rounded-lg px-3 py-2 text-sm flex flex-wrap items-center gap-3 ${problem ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-amber-50 border border-amber-300 text-amber-900'}`} data-testid="dirty-bar">
            <span>{problem ?? 'Unsaved changes to this chart.'}</span>
            <button className={`${btn} ${on}`} onClick={() => void save()} disabled={saving} data-testid="save">{saving ? 'Saving…' : 'Save'}</button>
            <button className={`${btn} ${off}`} onClick={undoLast} disabled={!undo.current.length} data-testid="undo">Undo</button>
            <button className={`${btn} ${off}`} onClick={() => void discard()} data-testid="discard">Discard changes</button>
          </div>
        )}
      </div>

      {mode === 'play' ? (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-white border border-stone-200 rounded-lg px-4 py-2 text-sm text-stone-700" data-testid="hud">
            <span className="text-2xl font-bold tabular-nums text-stone-900" data-testid="hud-accuracy">{judgedTotal ? `${Math.round(hud.accuracy)}%` : '—'}</span>
            <span className="text-green-700" data-testid="hud-perfect">{hud.perfect} perfect</span>
            <span className="text-amber-700" data-testid="hud-good">{hud.good} good</span>
            <span className="text-red-700" data-testid="hud-miss">{hud.miss} missed</span>
            <span className="text-stone-500" data-testid="hud-stray">{hud.stray} extra</span>
            <span>streak <b className="tabular-nums" data-testid="hud-combo">{hud.combo}</b> (best {hud.best})</span>
            <span className="text-stone-500 w-32" data-testid="hud-last">{hud.last}</span>
            {hud.perfect + hud.good >= 12 && Math.abs(hud.tendency) >= 12 && (
              <span className="flex items-center gap-2">
                You are {Math.round(Math.abs(hud.tendency))} ms {hud.tendency > 0 ? 'late' : 'early'} on average
                <button className={`${btn} ${off}`} data-testid="apply-offset" title="If that is your gear and not your playing, fold it into the timing offset" onClick={() => { setSettings({ ...settings, latencyMs: Math.round(settings.latencyMs + hud.tendency) }); resetScore() }}>
                  Use as my offset
                </button>
              </span>
            )}
            <button className={`${btn} ${off} ml-auto`} onClick={resetScore} data-testid="reset-score">Reset score</button>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-700" checked={showLyrics} onChange={(e) => setShowLyrics(e.target.checked)} data-testid="toggle-lyrics" />Lyrics</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-amber-700" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} data-testid="toggle-chords" />Chords</label>
          </div>
          {showLyrics && <LyricsPanel lyrics={work.lyrics} subscribe={subscribe} />}
          {showChords && <ChordStrip chords={work.chords} subscribe={subscribe} held={held} />}
        </>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg p-4 space-y-4" data-testid="editor">
          <div className="flex flex-wrap items-center gap-2">
            {([['bars', '1 · Bars & tempo'], ['drums', '2 · Drums'], ['chords', '3 · Chords'], ['lyrics', '4 · Lyrics']] as [EditTab, string][]).map(([id, label]) => (
              <button key={id} className={`${btn} ${tab === id ? 'bg-stone-800 text-white border-stone-800' : off}`} onClick={() => setTab(id)} data-testid={`tab-${id}`}>{label}</button>
            ))}
            <label className="flex items-center gap-1.5 text-sm text-stone-700 ml-4" title="Play a tick on every charted drum note, to check the chart by ear">
              <input type="checkbox" className="accent-amber-700" checked={audition} onChange={(e) => setAudition(e.target.checked)} data-testid="audition" />
              Tick on every charted note
            </label>
            <button className={`${btn} ${off} ml-auto`} onClick={() => void revert()} data-testid="revert">Start over from the draft</button>
          </div>
          {tab === 'bars' && <TempoPanel meter={work.meter} derived={derived} setMeter={(meter) => edit({ ...work, meter })} />}
          {tab === 'drums' && (
            <LaneEditor
              hits={work.drums}
              setHits={(drums) => edit({ ...work, drums })}
              derived={derived}
              grid={grid}
              kit={kit}
              peaks={peaks.drums}
              peaksPerSecond={peaks.per_second}
              duration={work.duration_s}
              subscribe={subscribe}
              onSeek={(t) => engine?.seek(t)}
              getTime={() => engine?.currentTime ?? 0}
              playing={playing}
            />
          )}
          {tab === 'chords' && <ChordEditor chords={work.chords} derived={derived} songKey={work.key} setChords={(chords) => edit({ ...work, chords })} />}
          {tab === 'lyrics' && <LyricsEditor lyrics={work.lyrics} setLyrics={(lyrics) => edit({ ...work, lyrics })} getTime={() => engine?.currentTime ?? 0} />}
        </div>
      )}

      <p className="text-xs text-stone-500">Click a bar to jump there. Drag across bars (or shift-click) to loop them. Space plays/pauses, ← → step by bar.</p>
      <Score ref={scoreRef} musicxml={xml} barQ={grid.barQ} loop={loop} onBarClick={onBarClick} onBarRange={(from, to) => setLoop({ from, to })} />
      {showSettings && <SettingsDialog kit={kit} settings={settings} setSettings={setSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}
