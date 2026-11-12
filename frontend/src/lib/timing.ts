import type { Derived } from './api'

/**
 * Maps between audio time (seconds) and score position (quarter notes from the
 * start of bar 1) through the bar grid. A beat is a quarter note in straight
 * time and a dotted quarter in compound time (6/8, 12/8), hence `qpb`.
 */
export class Grid {
  readonly beats: number[] // every beat of every bar, plus the end of the last bar
  readonly perBar: number
  readonly barCount: number
  readonly qpb: number
  readonly compound: boolean

  constructor(d: Derived) {
    this.perBar = d.per_bar
    this.barCount = d.bars.length
    this.qpb = d.qpb
    this.compound = d.compound
    this.beats = d.bars.flatMap((b) => b.beats)
    this.beats.push(d.bars[d.bars.length - 1].t1)
  }

  /** Position in beats (fractional) for a time. */
  timeToBeat(t: number): number {
    const b = this.beats
    if (t <= b[0]) return 0
    if (t >= b[b.length - 1]) return b.length - 1
    let lo = 0
    let hi = b.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (b[mid] <= t) lo = mid
      else hi = mid
    }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo])
  }

  beatToTime(x: number): number {
    const b = this.beats
    const c = Math.min(Math.max(x, 0), b.length - 1)
    const i = Math.min(Math.floor(c), b.length - 2)
    return b[i] + (c - i) * (b[i + 1] - b[i])
  }

  timeToQ(t: number): number {
    return this.timeToBeat(t) * this.qpb
  }

  /** Quarter notes per bar (what Verovio's timemap counts in). */
  get barQ(): number {
    return this.perBar * this.qpb
  }

  barAt(t: number): number {
    return Math.min(this.barCount, Math.floor(this.timeToBeat(t) / this.perBar + 1e-9) + 1)
  }

  barStart(bar: number): number {
    return this.beats[(bar - 1) * this.perBar]
  }

  barEnd(bar: number): number {
    return this.beats[bar * this.perBar]
  }

  clickBeats(): { time: number; accent: boolean }[] {
    return this.beats.slice(0, -1).map((time, i) => ({ time, accent: i % this.perBar === 0 }))
  }

  /** Nearest grid slot to a time, with `div` slots per beat. */
  snap(t: number, div: number): number {
    return this.beatToTime(Math.round(this.timeToBeat(t) * div) / div)
  }
}

export function formatTime(t: number): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}
