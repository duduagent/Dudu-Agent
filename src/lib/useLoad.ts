import { useCallback, useEffect, useRef, useState } from 'react'

/** Pemuat data async dengan state loading/error nyata dan reload manual. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(() => {
    const my = ++seq.current
    setLoading(true)
    fnRef.current()
      .then(d => { if (my === seq.current) { setData(d); setError(null) } })
      .catch(e => { if (my === seq.current) setError(e instanceof Error ? e.message : 'Gagal memuat data.') })
      .finally(() => { if (my === seq.current) setLoading(false) })
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); return () => { seq.current++ } }, deps)
  return { data, error, loading, reload, setData }
}
