import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chart } from '../lib/api'

type Subscribe = (fn: (t: number) => void) => () => void

/** Karaoke display: the line being sung, large, with the next lines underneath. */
export default function LyricsPanel({ lyrics, subscribe }: { lyrics: Chart['lyrics']; subscribe: Subscribe }) {
  const lines = useMemo(
    () => lyrics.lines.filter((l) => l.text.trim()).map((l) => ({ ...l, t: l.t + (lyrics.offset_s || 0) })),
    [lyrics],
  )
  const [idx, setIdx] = useState(-1)
  const cur = useRef(-1)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      subscribe((t) => {
        let i = -1
        for (let k = 0; k < lines.length && lines[k].t <= t + 0.05; k++) i = k
        if (i !== cur.current) {
          cur.current = i
          setIdx(i)
        }
        // progress through the current line (or the lead-in to the next one)
        if (barRef.current) {
          const a = i >= 0 ? lines[i].t : 0
          const b = i + 1 < lines.length ? lines[i + 1].t : a + 5
          barRef.current.style.width = `${Math.min(100, Math.max(0, ((t - a) / Math.max(0.2, b - a)) * 100))}%`
        }
      }),
    [lines, subscribe],
  )

  if (lines.length === 0) {
    return <div className="text-sm text-stone-500" data-testid="lyrics-empty">No lyrics for this song yet — add them in Edit → Lyrics.</div>
  }
  const next = lines[idx + 1]
  const waiting = idx < 0 || (next && lines[idx] && next.t - lines[idx].t > 12)
  return (
    <div className="bg-stone-900 text-stone-100 rounded-lg px-6 py-4" data-testid="lyrics">
      <div className="text-2xl md:text-3xl font-semibold min-h-[2.5rem]" data-testid="lyric-current">
        {idx >= 0 ? lines[idx].text : <span className="text-stone-500">♪</span>}
      </div>
      <div className="h-1 bg-stone-700 rounded mt-2 overflow-hidden">
        <div ref={barRef} className="h-full bg-amber-500" style={{ width: 0 }} />
      </div>
      <div className="mt-2 text-lg text-stone-400 min-h-[1.75rem]" data-testid="lyric-next">
        {next?.text ?? ''}
        {waiting && next && idx < 0 && <span className="ml-2 text-sm text-stone-500">(starts at {Math.floor(next.t / 60)}:{String(Math.floor(next.t % 60)).padStart(2, '0')})</span>}
      </div>
      <div className="text-sm text-stone-500 min-h-[1.25rem]">{lines[idx + 2]?.text ?? ''}</div>
    </div>
  )
}
