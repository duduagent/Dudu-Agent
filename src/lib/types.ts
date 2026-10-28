export type Role = 'user' | 'assistant' | 'system'
export type MsgStatus = 'sending' | 'done' | 'error'

/** Status lampiran pada pesan: 'analyzed' HANYA bila isinya benar-benar dikirim ke model dan balasan sukses. */
export interface MsgAttachment {
  fileId: string
  name: string
  category: string
  state: 'sent' | 'analyzed' | 'not_readable'
  reason?: string
}
export interface MsgSource { n: number; fileId: string; name: string; loc?: string | null }

/** Rute yang benar-benar dipakai server untuk menghasilkan pesan ini (jujur: dari server, bukan tebakan UI). */
export interface ModelRoute {
  mode: string
  task: { category: string; complexity: string; requiresVision: boolean; requiresTools?: boolean }
  providerId: string
  modelId: string
  tier: 'free' | 'paid' | 'unknown' | 'local'
  reason?: string
  escalationReason?: string | null
  fallback?: string[]
  attempts?: string[]
  considered?: string[]
  budget?: { state: string; cap: number; spent: number }
  usageProvenance: string
  costProvenance: string
  maxTokens?: number
  estimated?: boolean
}
export interface UsageInfo {
  usage: { input: number | null; output: number | null; total: number | null; cached: number | null }
  usageProvenance: 'PROVIDER_REPORTED' | 'ESTIMATED'
}
export interface CostInfo { amount: number | null; currency: string; provenance: string }

export interface Message {
  id: string
  role: Role
  content: string
  createdAt: number
  status?: MsgStatus
  error?: string
  attachments?: MsgAttachment[]
  sources?: MsgSource[]
  route?: ModelRoute
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export interface Prefs { leftCollapsed: boolean; rightCollapsed: boolean }
export type ProviderState = 'unknown' | 'ok' | 'unconfigured' | 'error'
export interface ProviderInfo { state: ProviderState; model?: string; detail?: string }
export interface ActivityEvent { id: string; message: string; at: number }
export type ViewId = 'chat' | 'missions' | 'execution' | 'workforce' | 'knowledge' | 'datainput' | 'tools' | 'skills' | 'files' | 'memory' | 'account' | 'mcp' | 'cli' | 'plugins' | 'connectors' | 'settings'
