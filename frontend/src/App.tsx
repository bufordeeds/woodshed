import { useEffect, useState } from 'react'
import LibraryPage from './pages/LibraryPage'
import SongPage from './pages/SongPage'

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export default function App() {
  const match = useHash().match(/^#\/song\/([a-z0-9-]+)$/)
  return (
    <div className="min-h-screen bg-stone-100">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="#/" className="text-xl font-bold text-stone-900">Woodshed</a>
          {match && <a href="#/" className="text-sm text-amber-800 hover:underline" data-testid="to-library">← Library</a>}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{match ? <SongPage key={match[1]} songId={match[1]} /> : <LibraryPage />}</main>
    </div>
  )
}
