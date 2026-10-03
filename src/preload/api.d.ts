export type PtyEvent =
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }
  | { type: 'started' }

export interface ChatBounds {
  x: number
  y: number
  width: number
  height: number
}

export type WindowSize = 'small' | 'medium' | 'large'

export interface InitPayload {
  recentFolders: string[]
  windowSize: WindowSize
  chatUrl: string
}

export interface CcApi {
  getInit(): Promise<InitPayload>
  setWindowSize(size: WindowSize): Promise<{ ok: boolean }>
  setChatUrl(url: string): Promise<{ ok: boolean; message?: string }>
  pickFolder(): Promise<string | null>
  setChatBounds(rect: ChatBounds | null): void
  addRecent(folder: string): Promise<string[]>
  startClaude(folder: string): Promise<{ ok: boolean; message: string }>
  stopClaude(): void
  ptyInput(data: string): void
  ptyResize(cols: number, rows: number): void
  onPty(cb: (ev: PtyEvent) => void): () => void
}

declare global {
  interface Window {
    cc: CcApi
  }
}
