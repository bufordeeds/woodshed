import type { RefObject } from 'react'

export const btn = 'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors disabled:opacity-40'
export const on = 'bg-amber-700 text-white border-amber-700 hover:bg-amber-800'
export const off = 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'

interface Props {
  ready: boolean
  playing: boolean
  onToggle(): void
  onRewind(): void
  timeRef: RefObject<HTMLSpanElement>
  barRef: RefObject<HTMLSpanElement>
  speed: number
  setSpeed(v: number): void
  click: boolean
  setClick(v: boolean): void
  loop: { from: number; to: number } | null
  setLoop(l: { from: number; to: number } | null): void
  barCount: number
  countIn: boolean
  setCountIn(v: boolean): void
}

export default function Transport(p: Props) {
  const setField = (field: 'from' | 'to', value: number) => {
    const v = Math.min(Math.max(Math.round(value) || 1, 1), p.barCount)
    const cur = p.loop ?? { from: v, to: v }
    p.setLoop(field === 'from' ? { from: v, to: Math.max(cur.to, v) } : { from: Math.min(cur.from, v), to: v })
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-testid="transport">
      <div className="flex items-center gap-2">
        <button className={`${btn} ${on} w-24`} onClick={p.onToggle} disabled={!p.ready} data-testid="play" title="Space">
          {p.playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button className={`${btn} ${off}`} disabled={!p.ready} onClick={p.onRewind} data-testid="rewind" title="Back to the start (or loop start)">
          ⏮
        </button>
        <div className="text-sm tabular-nums text-stone-700 w-44">
          <span ref={p.timeRef} data-testid="time">0:00.0</span>
          <span className="text-stone-400"> · </span>
          <span ref={p.barRef} data-testid="bar">bar 1</span>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        Speed
        <input type="range" min={50} max={100} step={5} value={p.speed} onChange={(e) => p.setSpeed(Number(e.target.value))} data-testid="speed" className="w-28 accent-amber-700" />
        <span className="tabular-nums w-10" data-testid="speed-label">{p.speed}%</span>
      </label>
      <label className="flex items-center gap-1.5 text-sm text-stone-700">
        <input type="checkbox" checked={p.click} onChange={(e) => p.setClick(e.target.checked)} data-testid="click" className="accent-amber-700" />
        Click
      </label>
      <div className="flex items-center gap-2 text-sm text-stone-700">
        <span>Loop bars</span>
        <input type="number" min={1} max={p.barCount} value={p.loop?.from ?? ''} placeholder="from" onChange={(e) => setField('from', Number(e.target.value))} data-testid="loop-from" className="w-16 border border-stone-300 rounded px-1.5 py-1" />
        <span>–</span>
        <input type="number" min={1} max={p.barCount} value={p.loop?.to ?? ''} placeholder="to" onChange={(e) => setField('to', Number(e.target.value))} data-testid="loop-to" className="w-16 border border-stone-300 rounded px-1.5 py-1" />
        <button className={`${btn} ${off}`} disabled={!p.loop} onClick={() => p.setLoop(null)} data-testid="loop-clear">
          Clear
        </button>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={p.countIn} onChange={(e) => p.setCountIn(e.target.checked)} data-testid="count-in" className="accent-amber-700" />
          Count-in
        </label>
      </div>
    </div>
  )
}
