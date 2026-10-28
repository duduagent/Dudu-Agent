import type { ModelRoute, MsgSource, Role, UsageInfo, CostInfo } from './types'

export class ProviderNotConfigured extends Error {}

const isDesktop = () => typeof window !== 'undefined' && !!window.dudu?.isDesktop

export const unreachableMessage = () =>
  isDesktop()
    ? 'Layanan API internal Dudu tidak merespons. Tutup lalu buka kembali aplikasi.'
    : 'Server API tidak terjangkau. Jalankan `npm run server`, lalu coba lagi.'

export const unconfiguredMessage = () =>
  isDesktop()
    ? 'Belum ada provider AI aktif. Buka Pengaturan → Gateway AI untuk mengisi kunci provider (atau menu Dudu AI → Buka folder konfigurasi → isi dudu.env), lalu klik Coba lagi.'
    : 'Belum ada provider AI aktif. Buka Pengaturan → Gateway AI untuk mengisi kunci provider (atau set DUDU_PROVIDER_API_KEY di server), lalu klik Coba lagi.'

export interface AttachmentReport { id: string; name: string; used: boolean; reason?: string; via?: string; truncated?: boolean }
export interface ProviderReply { content: string; model?: string; attachments?: AttachmentReport[]; sources?: MsgSource[]; route?: ModelRoute; usage?: UsageInfo; cost?: CostInfo }
export interface ChatInput { role: Role; content: string; fileIds?: string[] }

export async function sendChat(
  messages: ChatInput[],
  signal?: AbortSignal,
  opts: { useKnowledge?: boolean; mode?: string; modelRef?: { providerId: string; modelId: string } | null } = {},
): Promise<ProviderReply> {
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        ...(opts.useKnowledge ? { useKnowledge: true } : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.modelRef ? { modelRef: opts.modelRef } : {}),
      }),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ProviderNotConfigured(unreachableMessage())
  }
  if (res.status === 501) {
    throw new ProviderNotConfigured(unconfiguredMessage())
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { details?: unknown; message?: unknown }
      const d = typeof body.details === 'string' ? body.details : typeof body.message === 'string' ? body.message : ''
      detail = d.slice(0, 300)
    } catch { /* badan error bukan JSON */ }
    throw new Error(`Provider merespons ${res.status}${detail ? `: ${detail}` : '.'}`)
  }
  const data = (await res.json()) as {
    content?: unknown; model?: unknown; attachments?: AttachmentReport[]; sources?: MsgSource[]
    route?: unknown; usage?: unknown; cost?: unknown
  }
  if (typeof data.content !== 'string') throw new Error('Format respons provider tidak valid.')
  return {
    content: data.content, model: typeof data.model === 'string' ? data.model : undefined,
    attachments: Array.isArray(data.attachments) ? data.attachments : undefined,
    sources: Array.isArray(data.sources) ? data.sources : undefined,
    route: data.route as ModelRoute | undefined,
    usage: data.usage as UsageInfo | undefined,
    cost: data.cost as CostInfo | undefined,
  }
}
