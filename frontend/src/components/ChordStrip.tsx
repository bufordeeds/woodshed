import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chart } from '../lib/api'

type Subscribe = (fn: (t: number) => void) => () => void

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

/** Pitch classes of a chord name like "Am", "Bb7", "F#m7". */
export function chordTones(name: string): number[] {
  const m = name.match(/^([A-G])([#b]?)(.*)$/)
  if (!m) return []
  const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12
  const q = m[3].split('/')[0]
  const minor = /^(m|min)(?!aj)/.test(q)
  const third = q.startsWith('sus4') ? 5 : q.startsWith('sus2') ? 2 : minor ? 3 : 4
  const fifth = q.startsWith('dim') ? 6 : q.startsWith('aug') ? 8 : 7
  const tones = [0, q.startsWith('dim') ? 3 : third, fifth]
  if (q.includes('maj7')) tones.push(11)
  else if (q.includes('7')) tones.push(10)
  return tones.map((t) => (root + t) % 12)
}

/**
 * For whoever is on keys or guitar: the chord right now, big, and what is coming.
 * If a MIDI keyboard is connected, the held notes light up green when they belong to the chord.
 */
export default function ChordStrip({ chords, subscribe, held }: { chords: Chart['chords']; subscribe: Subscribe; held: number[] }) {
  const list = useMemo(() => chords.filter((c) => c.name && c.name !== 'N'), [chords])
  const [idx, setIdx] = useState(-1)
  const cur = useRef(-1)
  const countRef = useRef<HTMLSpanElement>(null)

  useEffect(
    () =>
      subscribe((t) => {
        let i = -1
        for (let k = 0; k < list.length && list[k].t <= t + 0.03; k++) i = k
        if (i !== cur.current) {
          cur.current = i
          setIdx(i)
        }
        if (countRef.current) {
          const next = list[i + 1]
          countRef.current.textContent = next ? `in ${Math.max(0, next.t - t).toFixed(1)}s` : ''
        }
      }),
    [list, subscribe],
  )

  if (list.length === 0) return <div className="text-sm text-stone-500">No chords for this song yet — add them in Edit → Chords.</div>
  const now = idx >= 0 ? list[idx].name : '—'
  const tones = idx >= 0 ? chordTones(now) : []
  const heldPcs = [...new Set(held.map((n) => n % 12))]
  return (
    <div className="flex flex-wrap items-center gap-6 bg-white border border-stone-200 rounded-lg px-5 py-3" data-testid="chords">
      <div>
        <div className="text-xs uppercase tracking-wide text-stone-500">Now</div>
        <div className="text-4xl font-bold text-stone-900 tabular-nums" data-testid="chord-now">{now}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-stone-500">Next <span ref={countRef} className="normal-case" /></div>
        <div className="text-2xl font-semibold text-stone-500" data-testid="chord-next">
          {list.slice(idx + 1, idx + 4).map((c) => c.name).join('  ·  ') || '—'}
        </div>
      </div>
      <div className="flex gap-1 ml-auto" aria-label="Chord tones" data-testid="chord-tones">
        {NAMES.map((n, pc) => {
          const inChord = tones.includes(pc)
          const isHeld = heldPcs.includes(pc)
          const cls = isHeld ? (inChord ? 'bg-green-600 text-white border-green-700' : 'bg-red-500 text-white border-red-600') : inChord ? 'bg-amber-100 border-amber-400 text-stone-900' : 'bg-stone-50 border-stone-200 text-stone-300'
          return (
            <div key={pc} className={`w-8 h-8 rounded border text-xs flex items-center justify-center ${cls}`} data-pc={pc} data-state={isHeld ? (inChord ? 'right' : 'wrong') : inChord ? 'tone' : 'off'}>
              {n}
            </div>
          )
        })}
      </div>
    </div>
  )
}
