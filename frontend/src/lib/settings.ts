/** Per-browser settings (pad map overrides, latency). Kept in localStorage: they belong to this machine + kit. */
export interface Settings {
  /** MIDI note -> drum family, or null to ignore. Overrides the default General MIDI map. */
  padMap: Record<string, string | null>
  /** How late your hits register compared with what you hear, in ms (found by the calibration screen). */
  latencyMs: number
  /** Treat notes on every MIDI channel as drums (off = only channel 10 is the kit, the rest is the keyboard). */
  allChannelsAreDrums: boolean
}

const KEY = 'woodshed.settings.v1'
const DEFAULTS: Settings = { padMap: {}, latencyMs: 0, allChannelsAreDrums: false }

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}
