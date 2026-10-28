export interface Backend {
  api: { handle: (req: unknown) => Promise<{ status: number; body?: unknown; raw?: Buffer; headers?: Record<string, string> }>; files: { save: (a: { name: string; bytes: Buffer }) => Promise<{ id: string; name: string }> }; kb: { indexFile: (id: string) => Promise<unknown> } }
  dir: string
  upstream: Array<{ url: string; body: { model: string; messages: Array<{ role: string; content: unknown }> } }>
  state: { silentProgress: boolean; down: boolean; hold: boolean; pending: unknown[]; xhrs: Array<{ aborted: boolean; headers: Record<string, string> }>; fetchCalls: Array<{ path: string; method: string; headers: Record<string, string> }>; rawFetch: null | ((input: unknown, init?: unknown) => Promise<Response>) }
  releaseUploads: () => Promise<void>
  seedFile: (name: string, bytes: Buffer) => Promise<{ id: string; name: string }>
  cleanup: () => Promise<void>
}
export function installBackend(opts?: { env?: Record<string, string>; reply?: (body: unknown) => string }): Promise<Backend>
