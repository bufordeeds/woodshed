import { STEMS, type StemName } from '../lib/api'
import { btn, off } from './Transport'

const LABEL: Record<StemName, string> = { vocals: 'Vocals', drums: 'Drums', bass: 'Bass', other: 'Other' }

export type Gains = Record<StemName, number>
export const FULL: Gains = { vocals: 1, drums: 1, bass: 1, other: 1 }

const PRESETS: { name: string; id: string; gains: Gains }[] = [
  { name: 'Full song', id: 'full', gains: FULL },
  { name: 'Karaoke', id: 'karaoke', gains: { ...FULL, vocals: 0 } },
  { name: 'No drums', id: 'nodrums', gains: { ...FULL, drums: 0 } },
  { name: 'Band practice', id: 'band', gains: { ...FULL, drums: 0, vocals: 0 } },
  { name: 'Drums only', id: 'drums', gains: { vocals: 0, drums: 1, bass: 0, other: 0 } },
]

/** Per-stem volume. Presets cover the usual cases: sing it, drum it, or both. */
export default function Mixer({ gains, setGains }: { gains: Gains; setGains(g: Gains): void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-stone-700" data-testid="mixer">
      <div className="flex gap-1">
        {PRESETS.map((p) => {
          const active = STEMS.every((s) => gains[s] === p.gains[s])
          return (
            <button key={p.id} className={`${btn} ${active ? 'bg-stone-800 text-white border-stone-800' : off}`} onClick={() => setGains(p.gains)} data-testid={`mix-${p.id}`}>
              {p.name}
            </button>
          )
        })}
      </div>
      {STEMS.map((s) => (
        <label key={s} className="flex items-center gap-1.5">
          <button
            className={`w-6 h-6 rounded border text-xs ${gains[s] > 0 ? 'bg-white border-stone-300' : 'bg-stone-300 border-stone-400 text-stone-600'}`}
            onClick={() => setGains({ ...gains, [s]: gains[s] > 0 ? 0 : 1 })}
            title={gains[s] > 0 ? 'Mute' : 'Unmute'}
            data-testid={`mute-${s}`}
            aria-pressed={gains[s] === 0}
          >
            {gains[s] > 0 ? '🔊' : '✕'}
          </button>
          <span>{LABEL[s]}</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(gains[s] * 100)} onChange={(e) => setGains({ ...gains, [s]: Number(e.target.value) / 100 })} className="w-20 accent-amber-700" data-testid={`gain-${s}`} />
        </label>
      ))}
    </div>
  )
}
