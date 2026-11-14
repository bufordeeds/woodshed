/**
 * Onset-anchored time-stretch (slow-down without pitch change) for drum-heavy audio.
 *
 * Generic WSOLA stretchers repeat short chunks of audio, which turns every drum
 * hit into a flam at 50% speed. Here the audio is cut at the known drum onsets
 * (from hits.json): the attack of each hit is copied untouched, and only the tail
 * up to the next hit is stretched (WSOLA, waveform-aligned overlap-add). So every
 * detected hit plays exactly once, exactly where the slowed-down grid says.
 */

// Hits are protected by the anchors, so the grains can be long (clean bass / sustained notes)
// without the flams that long grains cause in an ordinary WSOLA stretcher.
const ATTACK_MS = 30 // copied 1:1 after each anchor
const GRAIN_MS = 80 // WSOLA grain
const OVERLAP_MS = 20 // minimum cross-fade between grains
const SEARCH_MS = 15 // how far a grain may shift to line up waveforms

export interface StretchConfig {
  attack: number
  grain: number
  overlap: number
  search: number
}

export function stretchConfig(sampleRate: number): StretchConfig {
  const f = (ms: number) => Math.max(8, Math.round((ms * sampleRate) / 1000))
  return { attack: f(ATTACK_MS), grain: f(GRAIN_MS), overlap: f(OVERLAP_MS), search: f(SEARCH_MS) }
}

/**
 * Stretch one segment that begins on an anchor.
 * `src` holds `ls` interleaved stereo frames; exactly `lo` frames (lo >= ls) are written to `out` at frame `outAt`.
 */
export function stretchSegment(
  src: Float32Array,
  ls: number,
  out: Float32Array,
  outAt: number,
  lo: number,
  cfg: StretchConfig,
): void {
  const o0 = outAt * 2
  if (lo <= ls) {
    // nothing to stretch (or asked to shrink, which the player never does)
    out.set(src.subarray(0, lo * 2), o0)
    return
  }
  const att = Math.min(cfg.attack, ls >> 1)
  out.set(src.subarray(0, att * 2), o0)
  const lt = ls - att // tail frames available
  const ot = lo - att // tail frames to produce
  const g = Math.min(cfg.grain, Math.floor(lt * 0.6))
  if (g < 16) {
    // tail too short for overlap-add: hold it with linear interpolation (inaudible at this length)
    for (let i = 0; i < ot; i++) {
      const p = att + (i * (lt - 1)) / Math.max(1, ot - 1)
      const k = Math.min(ls - 2, Math.floor(p))
      const fr = p - k
      out[o0 + 2 * (att + i)] = src[2 * k] * (1 - fr) + src[2 * k + 2] * fr
      out[o0 + 2 * (att + i) + 1] = src[2 * k + 1] * (1 - fr) + src[2 * k + 3] * fr
    }
    return
  }
  const ov = Math.min(cfg.overlap, g >> 1)
  const n = Math.max(2, Math.ceil((ot - ov) / (g - ov))) // number of grains
  const hopOut = (ot - g) / (n - 1)
  const hopSrc = (lt - g) / (n - 1)

  // normalised correlation between the audio at `c` and at `ref`, over `len` frames (mono, every 2nd frame)
  const match = (c: number, ref: number, len: number): number => {
    let dot = 0
    let energy = 1e-9
    for (let i = 0; i < len; i += 2) {
      const a = src[2 * (c + i)] + src[2 * (c + i) + 1]
      const b = src[2 * (ref + i)] + src[2 * (ref + i) + 1]
      dot += a * b
      energy += a * a
    }
    return dot / Math.sqrt(energy)
  }
  const place = (sj: number, oj: number, len: number, fade: number): void => {
    for (let i = 0; i < fade; i++) {
      const w = (i + 0.5) / fade
      const o = o0 + 2 * (oj + i)
      const k = 2 * (sj + i)
      out[o] = out[o] * (1 - w) + src[k] * w
      out[o + 1] = out[o + 1] * (1 - w) + src[k + 1] * w
    }
    out.set(src.subarray(2 * (sj + fade), 2 * (sj + len)), o0 + 2 * (oj + fade))
  }

  // grain 0 continues straight on from the attack
  out.set(src.subarray(att * 2, (att + g) * 2), o0 + att * 2)
  let prevSrc = att
  let prevOut = att
  for (let j = 1; j < n - 1; j++) {
    const oj = att + Math.round(j * hopOut)
    const overlap = prevOut + g - oj // frames shared with the previous grain
    const natural = prevSrc + (oj - prevOut) // where the previous grain would simply continue
    const nominal = att + Math.round(j * hopSrc)
    const from = Math.max(att, nominal - cfg.search)
    const to = Math.min(ls - g, nominal + cfg.search)
    let sj = Math.min(Math.max(nominal, from), to)
    if (natural >= from && natural <= to) {
      sj = natural // no cut needed at all
    } else if (overlap > 4) {
      let best = -Infinity
      for (let c = from; c <= to; c++) {
        const score = match(c, natural, overlap)
        if (score > best) {
          best = score
          sj = c
        }
      }
    }
    place(sj, oj, g, Math.max(0, overlap))
    prevSrc = sj
    prevOut = oj
  }

  // The last grain must END exactly at the next anchor (source frame `ls`, output frame `lo`) so the
  // following attack continues seamlessly. Its start is still free: lengthening it by `e` frames
  // shifts where it meets the previous grain, which lets that last junction be waveform-aligned too.
  const baseStart = lo - g // output start with e = 0
  const maxE = Math.max(0, Math.min(2 * cfg.search, ls - g - att, baseStart - prevOut - 1))
  let bestE = 0
  let best = -Infinity
  for (let e = 0; e <= maxE; e++) {
    const oj = baseStart - e
    const natural = prevSrc + (oj - prevOut)
    const cross = Math.min(prevOut + g - oj, 2 * cfg.overlap, ls - natural)
    if (cross < 8 || natural < 0) continue
    const score = match(ls - g - e, natural, cross)
    if (score > best) {
      best = score
      bestE = e
    }
  }
  const oj = baseStart - bestE
  const fade = Math.max(0, Math.min(prevOut + g - oj, 2 * cfg.overlap))
  place(ls - g - bestE, oj, g + bestE, fade)
}

/** Sorted anchor frames from onset times: a little before each hit, with a minimum spacing. */
export function buildAnchors(onsetsSec: number[], sampleRate: number): Float64Array {
  const pre = 0.005 * sampleRate // detected onsets sit ~3 ms early on average, within ±10 ms
  const minGap = 0.06 * sampleRate
  const out: number[] = []
  for (const t of [...onsetsSec].sort((a, b) => a - b)) {
    const f = Math.max(0, Math.round(t * sampleRate - pre))
    if (out.length === 0 || f - out[out.length - 1] >= minGap) out.push(f)
  }
  return Float64Array.from(out)
}
