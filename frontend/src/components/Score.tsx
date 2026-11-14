import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { getToolkit, type TimemapEntry } from '../lib/verovio'

const SCALE = 38

interface BarBox {
  x0: number
  x1: number
  top: number
  bottom: number
  anchors: { q: number; x: number }[]
}

export interface ScoreHandle {
  /** Move the cursor to a score position in quarter notes from the start of bar 1. */
  setCursor(q: number, follow: boolean): void
  /** Colour one notehead (by chart note id), or clear it with null. */
  mark(id: string, verdict: string | null): void
  clearMarks(): void
}

interface Props {
  musicxml: string
  /** quarter notes per bar */
  barQ: number
  loop: { from: number; to: number } | null
  onBarClick(bar: number, extend: boolean): void
  onBarRange(from: number, to: number): void
}

const COLORS: Record<string, string> = { perfect: '#16a34a', good: '#d97706', miss: '#dc2626' }

/** Renders MusicXML with Verovio and overlays a moving cursor, loop highlight and hit/miss colours. */
const Score = forwardRef<ScoreHandle, Props>(function Score({ musicxml, barQ, loop, onBarClick, onBarRange }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<BarBox[]>([])
  const marks = useRef(new Map<string, string>())
  const lastTop = useRef(-1)
  const dragFrom = useRef<number | null>(null)
  const [width, setWidth] = useState(0)
  const [bars, setBars] = useState<BarBox[]>([])
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setWidth(el.clientWidth)
    let timer = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setWidth(el.clientWidth), 200)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  const paint = (id: string, verdict: string | null) => {
    const el = svgRef.current?.querySelector(`[id="${id}"]`) as SVGElement | null
    if (!el) return
    const head = (el.querySelector('.notehead') as SVGElement | null) ?? el
    head.style.fill = verdict ? COLORS[verdict] ?? '' : ''
    head.style.color = verdict ? COLORS[verdict] ?? '' : ''
    if (verdict) el.setAttribute('data-verdict', verdict)
    else el.removeAttribute('data-verdict')
  }

  useEffect(() => {
    if (!width || !musicxml) return
    let cancelled = false
    setRendering(true)
    ;(async () => {
      try {
        const tk = await getToolkit()
        if (cancelled) return
        tk.setOptions({
          pageWidth: Math.round((width * 100) / SCALE),
          pageHeight: 60000,
          adjustPageHeight: true,
          scale: SCALE,
          breaks: 'auto',
          header: 'none',
          footer: 'none',
          pageMarginLeft: 40,
          pageMarginRight: 40,
          pageMarginTop: 40,
          pageMarginBottom: 40,
          mnumInterval: 1,
          spacingSystem: 16,
        } as any)
        if (!tk.loadData(musicxml)) throw new Error('Verovio could not read the MusicXML')
        let svg = ''
        for (let p = 1; p <= tk.getPageCount(); p++) svg += `<div class="vrv-page">${tk.renderToSVG(p)}</div>`
        const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: true }) as unknown as TimemapEntry[]
        if (cancelled || !svgRef.current) return
        svgRef.current.innerHTML = svg
        const boxes = measure(svgRef.current, timemap, barQ)
        barsRef.current = boxes
        lastTop.current = -1
        setBars(boxes)
        setError(null)
        marks.current.forEach((v, id) => paint(id, v))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [musicxml, width, barQ])

  useImperativeHandle(
    ref,
    () => ({
      setCursor(q: number, follow: boolean) {
        const boxes = barsRef.current
        const cur = cursorRef.current
        if (!cur || boxes.length === 0) return
        const idx = Math.min(boxes.length - 1, Math.max(0, Math.floor(q / barQ + 1e-9)))
        const bar = boxes[idx]
        const a = bar.anchors
        let x = a[a.length - 1].x
        for (let i = 0; i < a.length - 1; i++) {
          if (q <= a[i + 1].q) {
            const span = a[i + 1].q - a[i].q
            x = a[i].x + (span > 0 ? Math.min(1, Math.max(0, (q - a[i].q) / span)) : 0) * (a[i + 1].x - a[i].x)
            break
          }
        }
        cur.style.display = 'block'
        cur.style.transform = `translate(${x.toFixed(1)}px, ${bar.top - 12}px)`
        cur.style.height = `${bar.bottom - bar.top + 24}px`
        cur.dataset.bar = String(idx + 1)
        cur.dataset.x = x.toFixed(1)
        if (follow && bar.top !== lastTop.current) {
          lastTop.current = bar.top
          const y = wrapRef.current!.getBoundingClientRect().top + bar.top
          if (y < 230 || y + (bar.bottom - bar.top) > window.innerHeight - 80) {
            window.scrollTo({ top: window.scrollY + y - 280, behavior: 'smooth' })
          }
        }
      },
      mark(id: string, verdict: string | null) {
        if (verdict) marks.current.set(id, verdict)
        else marks.current.delete(id)
        paint(id, verdict)
      },
      clearMarks() {
        marks.current.forEach((_, id) => paint(id, null))
        marks.current.clear()
      },
    }),
    [barQ],
  )

  const barAt = (clientX: number, clientY: number): number | null => {
    const wrap = wrapRef.current
    if (!wrap) return null
    const r = wrap.getBoundingClientRect()
    const x = clientX - r.left
    const y = clientY - r.top
    const boxes = barsRef.current
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      if (x >= b.x0 && x <= b.x1 && y >= b.top - 34 && y <= b.bottom + 34) return i + 1
    }
    return null
  }

  return (
    <div
      ref={wrapRef}
      className="relative select-none bg-white rounded-lg shadow-sm border border-stone-200 min-h-[160px] cursor-pointer"
      data-testid="score"
      data-bars={bars.length}
      onMouseDown={(e) => {
        dragFrom.current = barAt(e.clientX, e.clientY)
      }}
      onMouseUp={(e) => {
        const from = dragFrom.current
        dragFrom.current = null
        const to = barAt(e.clientX, e.clientY)
        if (from == null || to == null) return
        if (from !== to) onBarRange(Math.min(from, to), Math.max(from, to))
        else onBarClick(to, e.shiftKey)
      }}
    >
      {rendering && <div className="absolute inset-x-0 top-6 text-center text-sm text-stone-500">Rendering chart…</div>}
      {error && <div className="p-6 text-sm text-red-700">Could not render the chart: {error}</div>}
      {loop &&
        bars.slice(loop.from - 1, loop.to).map((b, i) => (
          <div
            key={i}
            className="absolute bg-amber-300/30 border-y-2 border-amber-400 pointer-events-none"
            data-testid="loop-bar"
            style={{ left: b.x0, width: b.x1 - b.x0, top: b.top - 12, height: b.bottom - b.top + 24 }}
          />
        ))}
      <div ref={svgRef} className="score-svg" />
      <div
        ref={cursorRef}
        data-testid="cursor"
        className="absolute left-0 top-0 w-[3px] -ml-[1px] rounded bg-rose-500/80 pointer-events-none"
        style={{ display: 'none', willChange: 'transform' }}
      />
    </div>
  )
})

export default Score

/** Read bar boxes and cursor anchors out of the rendered SVG. */
function measure(root: HTMLElement, timemap: TimemapEntry[], barQ: number): BarBox[] {
  const origin = root.getBoundingClientRect()
  const boxes: BarBox[] = []
  for (const system of Array.from(root.querySelectorAll('g.system'))) {
    const first = boxes.length
    let top = Infinity
    let bottom = -Infinity
    for (const m of Array.from(system.querySelectorAll('g.measure'))) {
      const lines = Array.from(m.querySelectorAll('g.staff > path'))
      const rects = (lines.length ? lines : [m]).map((el) => el.getBoundingClientRect())
      top = Math.min(top, ...rects.map((r) => r.top - origin.top))
      bottom = Math.max(bottom, ...rects.map((r) => r.bottom - origin.top))
      boxes.push({
        x0: Math.min(...rects.map((r) => r.left)) - origin.left,
        x1: Math.max(...rects.map((r) => r.right)) - origin.left,
        top: 0,
        bottom: 0,
        anchors: [],
      })
    }
    for (let i = first; i < boxes.length; i++) {
      boxes[i].top = top
      boxes[i].bottom = bottom
    }
  }
  for (const entry of timemap) {
    const ids = [...(entry.on ?? []), ...(entry.restsOn ?? [])]
    if (ids.length === 0) continue
    const bar = boxes[Math.floor(entry.qstamp / barQ + 1e-6)]
    if (!bar) continue
    for (const id of ids) {
      const el = root.querySelector(`[id="${id}"]`)
      if (!el || el.classList.contains('mRest')) continue
      const r = (el.querySelector('.notehead') ?? el).getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      bar.anchors.push({ q: entry.qstamp, x: r.left + r.width / 2 - origin.left })
      break
    }
  }
  boxes.forEach((bar, i) => {
    const q0 = i * barQ
    bar.anchors.sort((a, b) => a.q - b.q)
    if (bar.anchors.length === 0 || bar.anchors[0].q > q0 + 1e-6) bar.anchors.unshift({ q: q0, x: bar.x0 + 6 })
    bar.anchors.push({ q: q0 + barQ, x: bar.x1 })
  })
  return boxes
}
