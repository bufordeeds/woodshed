import { useMemo } from 'react'
import type { Chart, Derived } from '../lib/api'

/** One box per bar, one field per beat. Type a chord where it changes; leave a field empty to hold the previous one. */
export default function ChordEditor({ chords, derived, setChords, songKey }: { chords: Chart['chords']; derived: Derived; setChords(c: Chart['chords']): void; songKey: string }) {
  const beats = useMemo(() => derived.bars.flatMap((b) => b.beats), [derived])
  // chord shown on each beat = the change snapped to its nearest beat
  const cells = useMemo(() => {
    const out: string[] = beats.map(() => '')
    for (const c of chords) {
      let k = 0
      let best = Infinity
      for (let i = 0; i < beats.length; i++) {
        const d = Math.abs(beats[i] - c.t)
        if (d < best) {
          best = d
          k = i
        }
      }
      out[k] = c.name === 'N' ? '' : c.name
    }
    return out
  }, [chords, beats])

  const edit = (k: number, value: string) => {
    const next = [...cells]
    next[k] = value.trim()
    setChords(next.map((name, i) => ({ t: beats[i], name })).filter((c) => c.name))
  }

  return (
    <div className="space-y-2" data-testid="chord-editor">
      <p className="text-sm text-stone-600">
        Draft key: <b>{songKey || 'unknown'}</b>. The draft only guesses plain major and minor chords; type anything you like (Am7, F/A, Bbmaj7).
      </p>
      <div className="flex flex-wrap gap-2">
        {derived.bars.map((bar, b) => (
          <div key={bar.n} className="border border-stone-200 rounded-md bg-white px-1.5 pt-0.5 pb-1.5">
            <div className="text-[10px] text-stone-400">{bar.n}</div>
            <div className="flex gap-1">
              {bar.beats.map((_, i) => {
                const k = b * derived.per_bar + i
                return (
                  <input
                    key={i}
                    value={cells[k] ?? ''}
                    onChange={(e) => edit(k, e.target.value)}
                    className={`w-12 text-sm text-center border rounded py-0.5 ${cells[k] ? 'border-amber-400 bg-amber-50 font-semibold' : 'border-stone-200 text-stone-400'}`}
                    placeholder="·"
                    data-testid={`chord-${bar.n}-${i + 1}`}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
