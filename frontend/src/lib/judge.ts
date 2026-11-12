import type { ChartNote } from './api'

export type Verdict = 'perfect' | 'good' | 'miss'

export interface Judgement {
  verdict: Verdict | 'stray'
  note?: ChartNote
  /** positive = late, negative = early (ms of real time) */
  deltaMs?: number
}

export const WINDOW_MS = { perfect: 45, good: 100 }

/**
 * Scores drum hits against the charted notes. A hit counts for the nearest
 * not-yet-judged note of the same family (kick / snare / hi-hat / tom / cymbal)
 * inside the timing window; anything else is a stray hit. Windows are in real
 * time, so slowing the song down does not make it stricter.
 */
export class Judge {
  private notes: ChartNote[]
  private state = new Map<string, Verdict>()
  perfect = 0
  good = 0
  miss = 0
  stray = 0
  combo = 0
  bestCombo = 0
  private sumDelta = 0
  private nDelta = 0
  /** Notes before this song time are not judged (playback started or jumped here). */
  floor = 0

  constructor(notes: ChartNote[]) {
    this.notes = [...notes].sort((a, b) => a.t - b.t)
  }

  get judged(): Map<string, Verdict> {
    return this.state
  }

  /** Percentage of judged notes that were hit (perfect counts full, good counts 70%). */
  get accuracy(): number {
    const total = this.perfect + this.good + this.miss
    return total ? ((this.perfect + 0.7 * this.good) / total) * 100 : 0
  }

  /** Average early/late tendency in ms (negative = you rush). */
  get tendencyMs(): number {
    return this.nDelta ? this.sumDelta / this.nDelta : 0
  }

  reset(): string[] {
    const ids = [...this.state.keys()]
    this.state.clear()
    this.perfect = this.good = this.miss = this.stray = this.combo = this.bestCombo = 0
    this.sumDelta = this.nDelta = 0
    return ids
  }

  /** Forget verdicts for notes at or after `t` (after a seek or loop wrap). Returns their ids so they can be un-coloured. */
  rewind(t: number): string[] {
    const ids: string[] = []
    for (const n of this.notes) {
      if (n.t >= t - 0.02 && this.state.has(n.id)) {
        this.state.delete(n.id)
        ids.push(n.id)
      }
    }
    return ids
  }

  hit(family: string, songTime: number, speed: number): Judgement {
    const win = (WINDOW_MS.good / 1000) * speed // window in song seconds
    let best: ChartNote | undefined
    let bestD = Infinity
    for (let i = this.lowerBound(songTime - win); i < this.notes.length; i++) {
      const n = this.notes[i]
      if (n.t > songTime + win) break
      if (n.family !== family || this.state.has(n.id)) continue
      const d = Math.abs(n.t - songTime)
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    if (!best) {
      this.stray++
      this.combo = 0
      return { verdict: 'stray' }
    }
    const deltaMs = ((songTime - best.t) / speed) * 1000
    const verdict: Verdict = Math.abs(deltaMs) <= WINDOW_MS.perfect ? 'perfect' : 'good'
    this.state.set(best.id, verdict)
    this[verdict]++
    this.combo++
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.sumDelta += deltaMs
    this.nDelta++
    return { verdict, note: best, deltaMs }
  }

  /** Notes that went by unplayed between `from` and `to` (song seconds) become misses. */
  sweep(from: number, to: number, speed: number): ChartNote[] {
    const win = (WINDOW_MS.good / 1000) * speed
    const missed: ChartNote[] = []
    for (let i = this.lowerBound(from - win); i < this.notes.length; i++) {
      const n = this.notes[i]
      if (n.t + win >= to) break
      if (n.t + win >= from && n.t >= this.floor - 0.01 && !this.state.has(n.id)) {
        this.state.set(n.id, 'miss')
        this.miss++
        this.combo = 0
        missed.push(n)
      }
    }
    return missed
  }

  private lowerBound(t: number): number {
    let lo = 0
    let hi = this.notes.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.notes[mid].t < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
