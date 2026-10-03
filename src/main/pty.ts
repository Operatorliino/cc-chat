import { spawn as cpSpawn } from 'node:child_process'
import * as nodePty from '@lydell/node-pty'

export type PtyEvent =
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }
  | { type: 'started' }

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  return env
}

/** 定位全局安装的 claude 命令(Windows 下是 npm 目录里的 claude.cmd) */
function resolveClaude(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = cpSpawn('where', ['claude'], { shell: false })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0 || !out.trim()) return resolve(null)
      const line = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().endsWith('.cmd') || l.toLowerCase().endsWith('.exe'))
      resolve(line ?? null)
    })
  })
}

export class PtyManager {
  private proc: nodePty.IPty | null = null

  isRunning(): boolean {
    return this.proc !== null
  }

  async start(folder: string, onEvent: (ev: PtyEvent) => void): Promise<{ ok: boolean; message: string }> {
    if (this.proc) this.stop()
    const claude = await resolveClaude()
    if (!claude) {
      const msg = '未找到 claude 命令。请先执行: npm i -g @anthropic-ai/claude-code'
      onEvent({ type: 'error', message: msg })
      return { ok: false, message: msg }
    }
    try {
      const p = nodePty.spawn('cmd.exe', ['/c', claude], {
        name: 'xterm-256color',
        cwd: folder,
        env: buildEnv()
      })
      this.proc = p
      onEvent({ type: 'started' })
      p.onData((data) => onEvent({ type: 'data', data }))
      p.onExit(({ exitCode }) => {
        this.proc = null
        onEvent({ type: 'exit', exitCode })
      })
      return { ok: true, message: 'started' }
    } catch (err) {
      const msg = `启动失败: ${String(err)}`
      onEvent({ type: 'error', message: msg })
      return { ok: false, message: msg }
    }
  }

  input(data: string): void {
    this.proc?.write(data)
  }

  resize(cols: number, rows: number): void {
    if (!this.proc) return
    if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
      this.proc.resize(Math.round(cols), Math.round(rows))
    }
  }

  stop(): void {
    if (!this.proc) return
    try {
      this.proc.kill()
    } catch {
      /* 已退出则忽略 */
    }
    this.proc = null
  }
}
