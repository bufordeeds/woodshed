export type StemName = 'drums' | 'bass' | 'other' | 'vocals'
export const STEMS: StemName[] = ['vocals', 'drums', 'bass', 'other']

export interface Song {
  id: string
  title: string
  artist: string
  source: string
  status: 'queued' | 'processing' | 'ready' | 'error'
  stage: string
  progress: number
  error: string | null
  created: number
  duration_s?: number
}

export interface DrumHit {
  t: number
  d: string
  v: number
  c: number
}

export interface Meter {
  tempo?: 'normal' | 'half' | 'double' | 'thirds'
  beats_per_bar?: number | null
  shift?: number
  feel?: 'auto' | 'straight' | 'compound'
  offset_s?: number
}

export interface LyricLine {
  t: number
  text: string
  words?: { t: number; w: string }[]
}

/** chart.json — the editable source of truth for a song. */
export interface Chart {
  version: number
  title: string
  artist: string
  duration_s: number
  beats: number[]
  downbeats: number[]
  meter: Meter
  drums: DrumHit[]
  chords: { t: number; name: string }[]
  key: string
  lyrics: { source: string; offset_s: number; lines: LyricLine[]; matched?: string; lrc?: string }
}

export interface Bar {
  n: number
  t0: number
  t1: number
  beats: number[]
}

export interface ChartNote {
  id: string
  d: string
  family: string
  t: number
  tq: number
  v: number
  c: number
  bar: number
  beat: number
  slot: number
  div: number
  hits: number[]
}

/** Everything laid out from the chart by the server (never edited directly). */
export interface Derived {
  bars: Bar[]
  per_bar: number
  compound: boolean
  qpb: number
  time_signature: [number, number]
  tempo_bpm: number
  notes: ChartNote[]
  auto: string[]
}

export interface ChartBundle {
  song: Song
  chart: Chart
  derived: Derived
}

export interface Kit {
  drums: string[]
  families: string[]
  family: Record<string, string>
  names: Record<string, string>
  pad_map: Record<string, string | null>
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* not json */
    }
    throw new Error(detail)
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>)
}

const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

export const api = {
  kit: () => fetch('/api/kit').then((r) => json<Kit>(r)),
  songs: () => fetch('/api/songs').then((r) => json<Song[]>(r)),
  song: (id: string) => fetch(`/api/songs/${id}`).then((r) => json<Song>(r)),
  remove: (id: string) => fetch(`/api/songs/${id}`, { method: 'DELETE' }).then((r) => json<void>(r)),
  chart: (id: string) => fetch(`/api/songs/${id}/chart`).then((r) => json<ChartBundle>(r)),
  save: (id: string, chart: Chart) =>
    fetch(`/api/songs/${id}/chart`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chart) }).then(
      (r) => json<ChartBundle>(r),
    ),
  preview: (id: string, chart: Chart) =>
    post(`/api/songs/${id}/chart/preview`, chart).then((r) => json<{ chart: Chart; derived: Derived; musicxml: string }>(r)),
  revert: (id: string) => post(`/api/songs/${id}/chart/revert`).then((r) => json<ChartBundle>(r)),
  musicxml: (id: string) => fetch(`/api/songs/${id}/score.musicxml`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('No chart')))),
  peaks: (id: string) => fetch(`/api/songs/${id}/peaks`).then((r) => json<{ per_second: number; drums: number[]; vocals: number[] }>(r)),
  stemUrl: (id: string, name: StemName) => `/api/songs/${id}/stems/${name}`,
  musicxmlUrl: (id: string) => `/api/songs/${id}/score.musicxml?download=1`,
  midiUrl: (id: string) => `/api/songs/${id}/score.mid`,
}

/** Import from a file (with upload progress) or a link. */
export function importSong(
  input: { file?: File; url?: string; title?: string; artist?: string },
  onProgress: (fraction: number) => void,
): Promise<Song> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/songs')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let body: any = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as Song)
      else reject(new Error(body?.detail || `Import failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Could not reach Woodshed. Is it still running?'))
    const form = new FormData()
    if (input.file) form.append('file', input.file)
    if (input.url) form.append('url', input.url)
    form.append('title', input.title ?? '')
    form.append('artist', input.artist ?? '')
    xhr.send(form)
  })
}
