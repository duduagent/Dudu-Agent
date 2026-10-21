import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, uploadFile, type FileMeta } from './api'

/** Tahap lampiran di composer. 'ready' = konten benar-benar dapat dibaca AI; 'stored' = tersimpan tetapi tidak dapat dipahami. */
export type AttStage = 'selected' | 'uploading' | 'stored' | 'ready' | 'failed'
export interface Att {
  key: string; name: string; size: number; category: string
  stage: AttStage; progress: number // -1 = tidak diketahui (belum ada event progress dari transport)
  fileId?: string; previewUrl?: string; note?: string
}

const EXT_CATEGORY: Record<string, string> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', zip: 'archive',
  csv: 'data', tsv: 'data', json: 'data', xlsx: 'data',
}
const categoryOf = (name: string) => EXT_CATEGORY[(/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase()] ?? 'document'

let seq = 0
const newKey = () => `att-${Date.now()}-${++seq}`

export function useAttachments(maxCount: number, maxBytes: number) {
  const [items, setItems] = useState<Att[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const itemsRef = useRef<Att[]>([])
  itemsRef.current = items

  const patch = useCallback((key: string, p: Partial<Att>) => setItems(xs => xs.map(x => (x.key === key ? { ...x, ...p } : x))), [])
  const revoke = (a: Att) => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl) }

  const applyMeta = useCallback((key: string, meta: FileMeta) => {
    patch(key, meta.readiness.ready
      ? { stage: 'ready', progress: 100, fileId: meta.id, category: meta.category, note: undefined }
      : { stage: 'stored', progress: 100, fileId: meta.id, category: meta.category, note: meta.readiness.reason ?? 'Isi file tidak dapat dibaca.' })
  }, [patch])

  const addFiles = useCallback((files: File[]) => {
    const room = Math.max(0, maxCount - itemsRef.current.length)
    const accepted = files.slice(0, room)
    const msgs: string[] = []
    if (files.length > accepted.length) msgs.push(`Maksimal ${maxCount} lampiran per pesan; ${files.length - accepted.length} file diabaikan.`)
    const created: Array<{ att: Att; file: File }> = []
    for (const file of accepted) {
      const att: Att = { key: newKey(), name: file.name, size: file.size, category: categoryOf(file.name), stage: 'selected', progress: 0 }
      if (file.size === 0) { att.stage = 'failed'; att.note = 'File kosong.' }
      else if (file.size > maxBytes) { att.stage = 'failed'; att.note = `Melebihi batas ${Math.round(maxBytes / 1048576)} MB.` }
      else if (att.category === 'image' && file.type.startsWith('image/')) att.previewUrl = URL.createObjectURL(file)
      created.push({ att, file })
    }
    setNotices(n => [...n, ...msgs])
    setItems(xs => [...xs, ...created.map(c => c.att)])
    for (const { att, file } of created) {
      if (att.stage === 'failed') continue
      const ac = new AbortController()
      controllers.current.set(att.key, ac)
      patch(att.key, { stage: 'uploading', progress: -1 })
      uploadFile(file, { signal: ac.signal, onProgress: pct => patch(att.key, { progress: pct }) })
        .then(meta => applyMeta(att.key, meta))
        .catch(err => {
          if ((err as Error).name === 'AbortError') return
          patch(att.key, { stage: 'failed', note: err instanceof ApiError || err instanceof Error ? err.message : 'Upload gagal.' })
        })
        .finally(() => controllers.current.delete(att.key))
    }
  }, [maxCount, maxBytes, patch, applyMeta])

  const addStored = useCallback((meta: FileMeta) => {
    if (itemsRef.current.some(x => x.fileId === meta.id)) return
    if (itemsRef.current.length >= maxCount) { setNotices(n => [...n, `Maksimal ${maxCount} lampiran per pesan.`]); return }
    const att: Att = { key: newKey(), name: meta.name, size: meta.size, category: meta.category, stage: 'selected', progress: 100 }
    setItems(xs => [...xs, att])
    applyMeta(att.key, meta)
  }, [maxCount, applyMeta])

  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort(); controllers.current.delete(key)
    setItems(xs => { xs.filter(x => x.key === key).forEach(revoke); return xs.filter(x => x.key !== key) })
  }, [])

  const clear = useCallback(() => {
    for (const ac of controllers.current.values()) ac.abort()
    controllers.current.clear()
    setItems(xs => { xs.forEach(revoke); return [] })
    setNotices([])
  }, [])

  const dismissNotices = useCallback(() => setNotices([]), [])

  useEffect(() => () => { // bersihkan saat unmount: batalkan unggahan, bebaskan object URL
    for (const ac of controllers.current.values()) ac.abort()
    itemsRef.current.forEach(revoke)
  }, [])

  const busy = items.some(x => x.stage === 'uploading' || x.stage === 'selected')
  return { items, notices, busy, addFiles, addStored, remove, clear, dismissNotices }
}
