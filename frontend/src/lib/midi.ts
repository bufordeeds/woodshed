/**
 * MIDI in: the e-kit (channel 10) and a keyboard (any other channel), via Web MIDI.
 * Also accepts the computer keyboard as a stand-in kit so the game can be tried without hardware:
 *   X = kick, S = snare, H = hi-hat, T = tom, C = cymbal.
 */
export interface NoteEvent {
  kind: 'drum' | 'key'
  note: number
  velocity: number
  /** performance.now() timestamp of the hit */
  time: number
  on: boolean
}

type Listener = (e: NoteEvent) => void

const KEYBOARD_PADS: Record<string, number> = { KeyX: 36, KeyS: 38, KeyH: 42, KeyT: 47, KeyC: 49 }

export class MidiInput {
  devices: string[] = []
  supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  error: string | null = null
  allChannelsAreDrums = false
  private listeners = new Set<Listener>()
  private access: MIDIAccess | null = null
  onDevices?: () => void

  constructor() {
    window.addEventListener('keydown', this.onKey)
    // test / debug hook: window.__woodshedMidi(36) plays a kick "now"
    ;(window as any).__woodshedMidi = (note: number, velocity = 100, channel = 9, time = performance.now()) =>
      this.emit({ kind: channel === 9 || this.allChannelsAreDrums ? 'drum' : 'key', note, velocity, time, on: velocity > 0 })
  }

  async connect(): Promise<void> {
    if (!this.supported) {
      this.error = 'This browser has no Web MIDI (use Chrome, Edge or Firefox).'
      return
    }
    try {
      this.access = await navigator.requestMIDIAccess()
      this.access.onstatechange = () => this.bind()
      this.bind()
      this.error = null
    } catch {
      this.error = 'MIDI access was blocked. Allow it in the browser and reload.'
    }
  }

  private bind(): void {
    if (!this.access) return
    this.devices = []
    this.access.inputs.forEach((input) => {
      this.devices.push(input.name || 'MIDI device')
      input.onmidimessage = (m) => this.onMessage(m)
    })
    this.onDevices?.()
  }

  private onMessage(m: MIDIMessageEvent): void {
    const d = m.data
    if (!d || d.length < 3) return
    const type = d[0] & 0xf0
    const channel = d[0] & 0x0f
    if (type !== 0x90 && type !== 0x80) return
    const on = type === 0x90 && d[2] > 0
    const kind = channel === 9 || this.allChannelsAreDrums ? 'drum' : 'key'
    if (kind === 'drum' && !on) return
    this.emit({ kind, note: d[1], velocity: d[2], time: m.timeStamp || performance.now(), on })
  }

  private onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement)?.tagName
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const note = KEYBOARD_PADS[e.code]
    if (note !== undefined) this.emit({ kind: 'drum', note, velocity: 100, time: e.timeStamp || performance.now(), on: true })
  }

  private emit(e: NoteEvent): void {
    this.listeners.forEach((l) => l(e))
  }

  listen(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey)
    this.listeners.clear()
  }
}

let shared: MidiInput | null = null
export function midi(): MidiInput {
  if (!shared) {
    shared = new MidiInput()
    void shared.connect()
  }
  return shared
}
