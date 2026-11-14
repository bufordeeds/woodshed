import { useEffect, useState } from 'react'
import type { Chart } from '../lib/api'
import { btn, off } from './Transport'

const stamp = (t: number) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`
const toLrc = (lines: Chart['lyrics']['lines']) => lines.map((l) => `${stamp(l.t)} ${l.text}`).join('\n')

function parse(text: string): Chart['lyrics']['lines'] {
  const out: Chart['lyrics']['lines'] = []
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/)
    if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3] })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * Lyrics as timed lines ([mm:ss.xx] text). The usual fix is the whole song being early or late,
 * which the shift buttons handle; "Stamp" writes the current playback time onto the line the text cursor is on.
 */
export default function LyricsEditor({ lyrics, setLyrics, getTime }: { lyrics: Chart['lyrics']; setLyrics(l: Chart['lyrics']): void; getTime(): number }) {
  const [text, setText] = useState(() => toLrc(lyrics.lines))
  const [caret, setCaret] = useState(0)
  useEffect(() => {
    // refresh when lines change from outside (revert, undo) but not while typing the same content
    if (JSON.stringify(parse(text)) !== JSON.stringify(lyrics.lines.map((l) => ({ t: l.t, text: l.text })))) setText(toLrc(lyrics.lines))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrics.lines])

  const apply = (value: string) => {
    setText(value)
    setLyrics({ ...lyrics, lines: parse(value), source: lyrics.source === 'none' ? 'manual' : lyrics.source })
  }
  const shift = (d: number) => setLyrics({ ...lyrics, offset_s: +((lyrics.offset_s || 0) + d).toFixed(2) })
  const stampLine = () => {
    const start = text.lastIndexOf('\n', caret - 1) + 1
    const endIdx = text.indexOf('\n', caret)
    const end = endIdx < 0 ? text.length : endIdx
    const line = text.slice(start, end).replace(/^\s*\[[^\]]*\]\s*/, '')
    const t = Math.max(0, getTime() - (lyrics.offset_s || 0))
    apply(text.slice(0, start) + `${stamp(t)} ${line}` + text.slice(end))
  }

  return (
    <div className="space-y-3 text-sm text-stone-700" data-testid="lyrics-editor">
      <p className="text-stone-600">
        Source: <b>{lyrics.source}</b>
        {lyrics.matched && <> (matched “{lyrics.matched}”)</>}. {lyrics.lines.length} lines.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span>Whole song</span>
        <button className={`${btn} ${off}`} onClick={() => shift(-0.5)} data-testid="lyrics-earlier-big">−0.5 s</button>
        <button className={`${btn} ${off}`} onClick={() => shift(-0.1)} data-testid="lyrics-earlier">−0.1 s</button>
        <span className="tabular-nums w-20 text-center" data-testid="lyrics-offset">{(lyrics.offset_s || 0) >= 0 ? '+' : ''}{(lyrics.offset_s || 0).toFixed(1)} s</span>
        <button className={`${btn} ${off}`} onClick={() => shift(0.1)} data-testid="lyrics-later">+0.1 s</button>
        <button className={`${btn} ${off}`} onClick={() => shift(0.5)}>+0.5 s</button>
        <span className="text-stone-500">(earlier ← → later)</span>
        <button className={`${btn} ${off} ml-4`} onClick={stampLine} data-testid="lyrics-stamp" title="Set the selected line's time to where the song is now">
          Stamp line with current time
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => apply(e.target.value)}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        rows={14}
        spellCheck={false}
        className="w-full font-mono text-sm border border-stone-300 rounded-md p-3 bg-white"
        placeholder={'[00:12.50] First line of the song\n[00:16.20] Second line'}
        data-testid="lyrics-text"
      />
    </div>
  )
}
