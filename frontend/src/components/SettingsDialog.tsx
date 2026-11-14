import { useEffect, useState } from 'react'
import type { Kit } from '../lib/api'
import { midi } from '../lib/midi'
import type { Settings } from '../lib/settings'
import { btn, off, on } from './Transport'

/** MIDI devices, pad mapping (hit a pad, pick what it is) and the latency offset. */
export default function SettingsDialog({ kit, settings, setSettings, onClose }: { kit: Kit; settings: Settings; setSettings(s: Settings): void; onClose(): void }) {
  const input = midi()
  const [, force] = useState(0)
  const [last, setLast] = useState<{ note: number; kind: string } | null>(null)

  useEffect(() => {
    input.onDevices = () => force((n) => n + 1)
    const stop = input.listen((e) => e.on && setLast({ note: e.note, kind: e.kind }))
    return () => {
      stop()
      input.onDevices = undefined
    }
  }, [input])

  const mapped = (note: number): string | null | undefined => (String(note) in settings.padMap ? settings.padMap[String(note)] : kit.pad_map[String(note)])
  const assign = (note: number, family: string) =>
    setSettings({ ...settings, padMap: { ...settings.padMap, [String(note)]: family === 'ignore' ? null : family } })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 space-y-5 text-sm text-stone-700" onClick={(e) => e.stopPropagation()} data-testid="settings">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">Instruments</h2>
          <button className={`${btn} ${off}`} onClick={onClose} data-testid="settings-close">Close</button>
        </div>

        <section className="space-y-1">
          <h3 className="font-medium text-stone-900">Connected</h3>
          {input.error ? (
            <p className="text-red-700">{input.error}</p>
          ) : input.devices.length ? (
            <ul className="list-disc pl-5" data-testid="midi-devices">{input.devices.map((d, i) => <li key={i}>{d}</li>)}</ul>
          ) : (
            <p className="text-stone-500">No MIDI devices found. Plug in the kit or keyboard over USB; it appears here by itself.</p>
          )}
          <p className="text-stone-500">No kit handy? The computer keyboard works as pads: X kick, S snare, H hi-hat, T tom, C cymbal.</p>
          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" className="accent-amber-700" checked={settings.allChannelsAreDrums} onChange={(e) => setSettings({ ...settings, allChannelsAreDrums: e.target.checked })} />
            Treat every MIDI channel as drums (normally only channel 10 is the kit and the rest is the keyboard)
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium text-stone-900">Pads</h3>
          <p>Hit a pad. If it shows the wrong drum, pick the right one.</p>
          <div className="border border-stone-200 rounded-md p-3 min-h-[3.5rem]" data-testid="pad-learn">
            {last ? (
              last.kind === 'key' ? (
                <span>Keyboard note {last.note} (not a drum pad).</span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span>Pad sends note <b>{last.note}</b> →</span>
                  {[...kit.families, 'ignore'].map((f) => (
                    <button key={f} className={`${btn} ${(mapped(last.note) ?? 'ignore') === f ? on : off}`} onClick={() => assign(last.note, f)} data-testid={`assign-${f}`}>
                      {f}
                    </button>
                  ))}
                </div>
              )
            ) : (
              <span className="text-stone-400">Waiting for a hit…</span>
            )}
          </div>
          {Object.keys(settings.padMap).length > 0 && (
            <p className="text-stone-500">
              Your changes: {Object.entries(settings.padMap).map(([n, f]) => `${n} → ${f ?? 'ignore'}`).join(', ')}.{' '}
              <button className="underline" onClick={() => setSettings({ ...settings, padMap: {} })}>Reset to defaults</button>
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium text-stone-900">Timing offset</h3>
          <p>
            If good hits keep showing as late (or early), your sound or MIDI path adds delay. Play a section, then press “Use as my offset” in the score bar — or set it here.
          </p>
          <label className="flex items-center gap-2">
            <input type="number" step={5} value={settings.latencyMs} onChange={(e) => setSettings({ ...settings, latencyMs: Number(e.target.value) || 0 })} className="w-24 border border-stone-300 rounded px-2 py-1" data-testid="latency" />
            ms (positive = my hits register late)
          </label>
        </section>
      </div>
    </div>
  )
}
