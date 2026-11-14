import type { Bar, DrumHit } from './api'

/** A hit this close before a bar line is that bar's beat 1 played early, not the end of the bar before. */
const EARLY_S = 0.04

const inBar = (t: number, bar: Bar) => t >= bar.t0 - EARLY_S && t < bar.t1 - EARLY_S

/**
 * Copy every drum hit of one bar onto a range of bars, replacing what is there.
 * Each hit keeps its place within its beat, so the copy follows the song's own tempo drift.
 * Copied hits get full confidence: a person chose them.
 */
export function copyBar(hits: DrumHit[], bars: Bar[], source: number, from: number, to: number): DrumHit[] {
  const src = bars.find((b) => b.n === source)
  if (!src) return hits
  const edges = (b: Bar) => [...b.beats, b.t1]
  const se = edges(src)
  const pattern = hits.filter((h) => inBar(h.t, src)).map((h) => {
    let i = se.length - 2
    while (i > 0 && h.t < se[i]) i--
    return { hit: h, beat: i, frac: (h.t - se[i]) / (se[i + 1] - se[i]) }
  })
  const targets = bars.filter((b) => b.n >= Math.min(from, to) && b.n <= Math.max(from, to) && b.n !== source && b.beats.length === src.beats.length)
  if (!targets.length) return hits
  const out = hits.filter((h) => !targets.some((b) => inBar(h.t, b)))
  for (const b of targets) {
    const te = edges(b)
    for (const p of pattern) out.push({ ...p.hit, t: +(te[p.beat] + p.frac * (te[p.beat + 1] - te[p.beat])).toFixed(4), c: 1 })
  }
  return out.sort((a, b) => a.t - b.t || a.d.localeCompare(b.d))
}
