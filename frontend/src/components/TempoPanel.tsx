import type { Derived, Meter } from '../lib/api'
import { btn, off } from './Transport'

/**
 * Step 1 of fixing a chart: get the bar lines right. Everything else hangs off them.
 * These settings re-read the tracked beats; they never throw data away.
 */
export default function TempoPanel({ meter, derived, setMeter }: { meter: Meter; derived: Derived; setMeter(m: Meter): void }) {
  const set = (patch: Meter) => setMeter({ ...meter, ...patch })
  const sel = 'border border-stone-300 rounded px-2 py-1.5 text-sm bg-white'
  return (
    <div className="space-y-3 text-sm text-stone-700" data-testid="tempo-panel">
      <p className="text-stone-600">
        Reads as <b data-testid="meter-readout">{derived.time_signature[0]}/{derived.time_signature[1]}</b> at about{' '}
        <b>{Math.round(derived.tempo_bpm)}</b> beats per minute, {derived.bars.length} bars.
        {derived.auto.length > 0 && <span className="text-stone-500"> (Auto: {derived.auto.join(', ')}.)</span>} Turn the click on and listen: the high click should
        land on beat 1.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span>Bar line</span>
          <button className={`${btn} ${off}`} onClick={() => set({ shift: (meter.shift ?? 0) + 1 })} data-testid="shift-earlier" title="Beat 1 is one beat earlier than shown">
            ← one beat earlier
          </button>
          <button className={`${btn} ${off}`} onClick={() => set({ shift: (meter.shift ?? 0) - 1 })} data-testid="shift-later" title="Beat 1 is one beat later than shown">
            one beat later →
          </button>
        </div>
        <label className="flex items-center gap-2">
          Tempo
          <select className={sel} value={meter.tempo ?? 'normal'} onChange={(e) => set({ tempo: e.target.value as Meter['tempo'], shift: 0 })} data-testid="tempo-mode">
            <option value="normal">as tracked</option>
            <option value="half">half (every 2nd beat)</option>
            <option value="double">double</option>
            <option value="thirds">group beats in threes</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Beats per bar
          <select className={sel} value={meter.beats_per_bar ?? 0} onChange={(e) => set({ beats_per_bar: Number(e.target.value) || null, shift: 0 })} data-testid="beats-per-bar">
            <option value={0}>auto ({derived.per_bar})</option>
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Feel
          <select className={sel} value={meter.feel ?? 'auto'} onChange={(e) => set({ feel: e.target.value as Meter['feel'] })} data-testid="feel">
            <option value="auto">auto ({derived.compound ? 'triplet' : 'straight'})</option>
            <option value="straight">straight (2s and 4s)</option>
            <option value="compound">triplet (6/8, 12/8, shuffle)</option>
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span>Nudge grid</span>
          <button className={`${btn} ${off}`} onClick={() => set({ offset_s: +((meter.offset_s ?? 0) - 0.01).toFixed(3) })} data-testid="nudge-earlier">−10 ms</button>
          <span className="tabular-nums w-14 text-center" data-testid="nudge-value">{Math.round((meter.offset_s ?? 0) * 1000)} ms</span>
          <button className={`${btn} ${off}`} onClick={() => set({ offset_s: +((meter.offset_s ?? 0) + 0.01).toFixed(3) })} data-testid="nudge-later">+10 ms</button>
        </div>
      </div>
    </div>
  )
}
