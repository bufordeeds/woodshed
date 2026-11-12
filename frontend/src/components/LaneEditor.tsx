import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Derived, DrumHit, Kit } from '../lib/api'
import type { Grid } from '../lib/timing'
import { btn, off, on } from './Transport'

type Subscribe = (fn: (t: number) => void) => () => void

interface Props {
  hits: DrumHit[]
  setHits(hits: DrumHit[]): void
  derived: Derived
  grid: Grid
  kit: Kit
  peaks: number[]
  peaksPerSecond: number
  duration: number
  subscribe: Subscribe
  onSeek(t: number): void
  getTime(): number
  playing: boolean
}

const LANE_H = 22
const RULER_H = 22
const WAVE_H = 56
const LABEL_W = 92

/**
 * Drum lane editor: one row per drum over the isolated drum stem's waveform.
 * Click an empty spot to add a hit (snapped to the grid), click a hit to select it,
 * drag to move it in time or to another drum, Delete to remove. Faint hits are ones
 * the model was unsure about - check those first.
 */
export default function LaneEditor(p: Props) {
  const lanes = [...p.kit.drums].reverse() // high on the staff = top row
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(140) // px per second
  const [snap, setSnap] = useState<'grid' | 'triplet' | 'off'>('grid')
  const [follow, setFollow] = useState(true)
  const [selected, setSelected] = useState<Set<DrumHit>>(new Set())
  const [width, setWidth] = useState(800)
  const scroll = useRef(0)
  const playhead = useRef(0)
  const drag = useRef<{ hit: DrumHit; startX: number; startY: number; moved: boolean; orig: DrumHit } | null>(null)
  const state = useRef({ hits: p.hits, selected, zoom })
  state.current = { hits: p.hits, selected, zoom }
  const height = RULER_H + lanes.length * LANE_H + WAVE_H

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const z = state.current.zoom
    const t0 = scroll.current / z
    const t1 = t0 + (width - LABEL_W) / z
    const X = (t: number) => LABEL_W + (t - t0) * z

    // lanes
    lanes.forEach((_d, i) => {
      const y = RULER_H + i * LANE_H
      ctx.fillStyle = i % 2 ? '#fafaf9' : '#f5f5f4'
      ctx.fillRect(LABEL_W, y, width - LABEL_W, LANE_H)
    })
    // grid: bars, beats, slots
    const sub = p.grid.compound ? 6 : 4
    for (const bar of p.derived.bars) {
      if (bar.t1 < t0 || bar.t0 > t1) continue
      bar.beats.forEach((b, k) => {
        const next = k + 1 < bar.beats.length ? bar.beats[k + 1] : bar.t1
        if (z >= 90) {
          ctx.strokeStyle = '#e7e5e4'
          ctx.lineWidth = 1
          for (let s = 1; s < sub; s++) {
            const x = Math.round(X(b + ((next - b) * s) / sub)) + 0.5
            ctx.beginPath()
            ctx.moveTo(x, RULER_H)
            ctx.lineTo(x, RULER_H + lanes.length * LANE_H)
            ctx.stroke()
          }
        }
        const x = Math.round(X(b)) + 0.5
        ctx.strokeStyle = k === 0 ? '#78716c' : '#d6d3d1'
        ctx.lineWidth = k === 0 ? 1.5 : 1
        ctx.beginPath()
        ctx.moveTo(x, k === 0 ? 0 : RULER_H)
        ctx.lineTo(x, height)
        ctx.stroke()
      })
      ctx.fillStyle = '#57534e'
      ctx.font = '11px ui-sans-serif, system-ui'
      ctx.fillText(String(bar.n), X(bar.t0) + 4, 14)
    }
    // waveform of the drum stem
    const wy = RULER_H + lanes.length * LANE_H
    ctx.fillStyle = '#a8a29e'
    const pps = p.peaksPerSecond
    for (let x = LABEL_W; x < width; x++) {
      const i = Math.floor((t0 + (x - LABEL_W) / z) * pps)
      if (i < 0 || i >= p.peaks.length) continue
      const j = Math.min(p.peaks.length, Math.floor((t0 + (x + 1 - LABEL_W) / z) * pps) + 1)
      let m = 0
      for (let k = i; k < j; k++) m = Math.max(m, p.peaks[k])
      const h = (m / 255) * (WAVE_H - 6)
      ctx.fillRect(x, wy + (WAVE_H - h) / 2, 1, Math.max(1, h))
    }
    // hits
    for (const h of state.current.hits) {
      if (h.t < t0 - 0.1 || h.t > t1 + 0.1) continue
      const lane = lanes.indexOf(h.d)
      if (lane < 0) continue
      const x = X(h.t)
      const y = RULER_H + lane * LANE_H + LANE_H / 2
      const sel = state.current.selected.has(h)
      ctx.beginPath()
      ctx.arc(x, y, sel ? 7 : 6, 0, Math.PI * 2)
      ctx.fillStyle = sel ? '#b45309' : h.c < 0.45 ? 'rgba(68,64,60,0.35)' : '#292524'
      ctx.fill()
      if (sel) {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
    // labels (drawn last so hits scroll under them)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, LABEL_W, height)
    ctx.fillStyle = '#44403c'
    ctx.font = '12px ui-sans-serif, system-ui'
    lanes.forEach((d, i) => ctx.fillText(p.kit.names[d] ?? d, 8, RULER_H + i * LANE_H + 15))
    ctx.fillStyle = '#a8a29e'
    ctx.fillText('drum stem', 8, wy + WAVE_H / 2 + 4)
    // playhead
    const px = X(playhead.current)
    if (px >= LABEL_W && px <= width) {
      ctx.strokeStyle = '#e11d48'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, height)
      ctx.stroke()
    }
  }, [width, height, lanes, p.derived, p.grid, p.peaks, p.peaksPerSecond, p.kit])

  useEffect(() => draw(), [draw, p.hits, selected, zoom])

  // playhead + follow
  useEffect(
    () =>
      p.subscribe((t) => {
        playhead.current = t
        const el = wrapRef.current
        if (el && follow && p.playing) {
          const x = t * state.current.zoom
          const view = el.clientWidth - LABEL_W
          if (x < el.scrollLeft || x > el.scrollLeft + view * 0.85) el.scrollLeft = Math.max(0, x - view * 0.15)
        }
        draw()
      }),
    [p.subscribe, p.playing, follow, draw],
  )

  const locate = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const t = scroll.current / zoom + (x - LABEL_W) / zoom
    const lane = Math.floor((y - RULER_H) / LANE_H)
    return { x, y, t, lane }
  }
  const hitAt = (t: number, lane: number): DrumHit | null => {
    const tol = 8 / zoom
    let best: DrumHit | null = null
    for (const h of p.hits) {
      if (lanes.indexOf(h.d) !== lane || Math.abs(h.t - t) > tol) continue
      if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h
    }
    return best
  }
  const snapTime = (t: number, free: boolean) => {
    if (snap === 'off' || free) return t
    return p.grid.snap(t, snap === 'triplet' ? 3 : p.grid.compound ? 6 : 4)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    const { x, y, t, lane } = locate(e)
    if (x < LABEL_W) return
    if (y < RULER_H || lane >= lanes.length) {
      p.onSeek(Math.max(0, t))
      return
    }
    const h = hitAt(t, lane)
    if (h) {
      setSelected(e.shiftKey ? new Set([...selected, h]) : new Set([h]))
      drag.current = { hit: h, startX: e.clientX, startY: e.clientY, moved: false, orig: h }
    } else {
      const nh: DrumHit = { t: +Math.max(0, snapTime(t, e.altKey)).toFixed(4), d: lanes[lane], v: 100, c: 1 }
      p.setHits([...p.hits, nh])
      setSelected(new Set([nh]))
    }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientX - d.startX) < 4 && Math.abs(e.clientY - d.startY) < 6) return
    d.moved = true
    const { t, lane } = locate(e)
    const moved: DrumHit = { ...d.orig, t: +Math.max(0, snapTime(t, e.altKey)).toFixed(4), d: lanes[Math.min(lanes.length - 1, Math.max(0, lane))], c: 1 }
    p.setHits(p.hits.map((h) => (h === d.hit ? moved : h)))
    d.hit = moved
    setSelected(new Set([moved]))
  }
  const onMouseUp = () => {
    drag.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.current.selected.size) {
        e.preventDefault()
        p.setHits(state.current.hits.filter((h) => !state.current.selected.has(h)))
        setSelected(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.setHits])

  const unsure = p.hits.filter((h) => h.c < 0.45).length
  const jumpUnsure = () => {
    const now = p.getTime()
    const next = p.hits.filter((h) => h.c < 0.45 && h.t > now + 0.05).sort((a, b) => a.t - b.t)[0] ?? p.hits.filter((h) => h.c < 0.45).sort((a, b) => a.t - b.t)[0]
    if (!next) return
    setSelected(new Set([next]))
    p.onSeek(Math.max(0, next.t - 1))
    if (wrapRef.current) wrapRef.current.scrollLeft = Math.max(0, next.t * zoom - 200)
  }

  return (
    <div className="space-y-2" data-testid="lane-editor">
      <div className="flex flex-wrap items-center gap-3 text-sm text-stone-700">
        <span data-testid="hit-count">{p.hits.length} hits</span>
        <button className={`${btn} ${off}`} onClick={jumpUnsure} disabled={!unsure} data-testid="next-unsure">
          Next unsure hit ({unsure})
        </button>
        <button className={`${btn} ${off}`} disabled={!selected.size} data-testid="delete-selected" onClick={() => { p.setHits(p.hits.filter((h) => !selected.has(h))); setSelected(new Set()) }}>
          Delete selected
        </button>
        <label className="flex items-center gap-1.5">
          Snap
          <select className="border border-stone-300 rounded px-2 py-1 bg-white" value={snap} onChange={(e) => setSnap(e.target.value as typeof snap)} data-testid="snap">
            <option value="grid">{p.grid.compound ? '16ths (6 per beat)' : '16ths'}</option>
            <option value="triplet">triplets</option>
            <option value="off">off</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Zoom
          <input type="range" min={40} max={400} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-28 accent-amber-700" data-testid="zoom" />
        </label>
        <button className={`${btn} ${follow ? on : off}`} onClick={() => setFollow(!follow)}>Follow playback</button>
        <span className="text-xs text-stone-500">Click = add · drag = move · Delete = remove · Alt = no snap · click the ruler to jump</span>
      </div>
      <div
        ref={wrapRef}
        className="relative overflow-x-auto border border-stone-200 rounded-lg bg-white"
        onScroll={(e) => {
          scroll.current = (e.target as HTMLDivElement).scrollLeft
          draw()
        }}
        data-testid="lane-scroll"
      >
        <div style={{ width: LABEL_W + p.duration * zoom + 40, height }}>
          <canvas
            ref={canvasRef}
            style={{ width, height, position: 'sticky', left: 0, display: 'block', cursor: 'crosshair' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            data-testid="lane-canvas"
          />
        </div>
      </div>
    </div>
  )
}
