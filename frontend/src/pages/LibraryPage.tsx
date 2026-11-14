import { useEffect, useRef, useState } from 'react'
import { api, importSong, type Song } from '../lib/api'

const ACCEPT = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'webm', 'mp4']

export default function LibraryPage() {
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const load = async () => {
      try {
        const list = await api.songs()
        if (cancelled) return
        setSongs(list)
        if (list.some((s) => s.status === 'queued' || s.status === 'processing')) timer = window.setTimeout(load, 2000)
      } catch {
        if (!cancelled) setSongs([])
      }
    }
    void load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const pick = (f: File | undefined) => {
    if (!f) return
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ACCEPT.includes(ext)) {
      setError(`Unsupported file type ".${ext}".`)
      return
    }
    setError(null)
    setFile(f)
    setUrl('')
  }
  const start = async () => {
    if (!file && !url.trim()) {
      setError('Paste a link or choose a file first.')
      return
    }
    setError(null)
    setProgress(0)
    try {
      const song = await importSong({ file: file ?? undefined, url: file ? undefined : url.trim(), title, artist }, setProgress)
      window.location.hash = `#/song/${song.id}`
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    }
  }
  const remove = async (s: Song) => {
    if (!window.confirm(`Delete “${s.title}” and its files?`)) return
    await api.remove(s.id)
    setSongs((list) => (list ?? []).filter((x) => x.id !== s.id))
  }

  const field = 'w-full border border-stone-300 rounded-md px-3 py-2 text-sm bg-white'
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div
        className={`bg-white rounded-lg border-2 p-6 space-y-3 transition-colors ${dragging ? 'border-amber-600 bg-amber-50' : 'border-stone-200'}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files[0])
        }}
        data-testid="import"
      >
        <h2 className="text-lg font-medium text-stone-900">Add a song</h2>
        <div className="flex gap-2">
          <input className={field} placeholder="Paste a YouTube link…" value={file ? '' : url} disabled={!!file} onChange={(e) => setUrl(e.target.value)} data-testid="import-url" />
          <span className="self-center text-sm text-stone-400">or</span>
          <button className="shrink-0 px-3 py-2 rounded-md border border-stone-300 text-sm hover:bg-stone-50" onClick={() => input.current?.click()} data-testid="choose-file">
            {file ? `✓ ${file.name}` : 'Choose a file'}
          </button>
          {file && <button className="text-sm text-stone-500 underline" onClick={() => setFile(null)}>clear</button>}
          <input ref={input} type="file" accept={ACCEPT.map((e) => `.${e}`).join(',') + ',audio/*'} className="hidden" data-testid="file-input" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className={field} placeholder="Song title (helps find the lyrics)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="import-title" />
          <input className={field} placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} data-testid="import-artist" />
        </div>
        {progress === null ? (
          <button className="px-4 py-2 rounded-md bg-amber-700 text-white text-sm font-medium hover:bg-amber-800" onClick={() => void start()} data-testid="import-go">
            Import
          </button>
        ) : (
          <div data-testid="upload-progress">
            <div className="h-2 bg-stone-200 rounded-full overflow-hidden"><div className="h-full bg-amber-700 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="mt-1 text-sm text-stone-600">Sending… {Math.round(progress * 100)}%</p>
          </div>
        )}
        {error && <p className="text-sm text-red-700" data-testid="import-error">{error}</p>}
        <p className="text-xs text-stone-500">
          Woodshed splits the song into vocals, drums, bass and the rest, then drafts the drum chart, chords and lyrics. Everything stays on this computer; only the song title and
          artist are sent out, to look up lyrics.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-stone-700 mb-2">Your songs</h3>
        {songs === null ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : songs.length === 0 ? (
          <p className="text-sm text-stone-500" data-testid="library-empty">Nothing here yet. Add the first song above.</p>
        ) : (
          <ul className="bg-white rounded-lg border border-stone-200 divide-y divide-stone-100" data-testid="library">
            {songs.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
                <a href={`#/song/${s.id}`} className="flex-1 min-w-0">
                  <span className="font-medium text-stone-900">{s.title}</span>
                  {s.artist && <span className="text-stone-500"> — {s.artist}</span>}
                </a>
                <span className={`text-sm ${s.status === 'ready' ? 'text-green-700' : s.status === 'error' ? 'text-red-700' : 'text-stone-500'}`}>
                  {s.status === 'ready' ? (s.duration_s ? `${Math.floor(s.duration_s / 60)}:${String(Math.round(s.duration_s % 60)).padStart(2, '0')}` : 'ready') : s.status === 'processing' ? `${s.progress}%` : s.status}
                </span>
                <button className="text-sm text-stone-400 hover:text-red-700" onClick={() => void remove(s)} title="Delete" data-testid={`delete-${s.id}`}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
