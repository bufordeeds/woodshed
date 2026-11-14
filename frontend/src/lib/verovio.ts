import type { VerovioToolkit } from 'verovio/esm'

let toolkit: Promise<VerovioToolkit> | null = null

/** Verovio is ~7 MB of WASM-in-JS, so it is loaded lazily and only once. */
export function getToolkit(): Promise<VerovioToolkit> {
  if (!toolkit) {
    toolkit = (async () => {
      const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
        import('verovio/wasm'),
        import('verovio/esm'),
      ])
      const module = await createVerovioModule()
      return new VerovioToolkit(module)
    })()
    toolkit.catch(() => (toolkit = null))
  }
  return toolkit
}

export interface TimemapEntry {
  qstamp: number
  tstamp: number
  on?: string[]
  off?: string[]
  restsOn?: string[]
  measureOn?: string
}
