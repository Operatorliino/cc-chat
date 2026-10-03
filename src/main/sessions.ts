import { openSync, readSync, closeSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SessionInfo {
  id: string
  title: string
  mtime: number
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** 从 jsonl 文件头部提取:cwd 校验 + 标题(优先 summary,其次第一条用户消息) */
function probeSession(file: string, target: string): SessionInfo | null {
  const id = file.replace(/\.jsonl$/, '')
  let fd = -1
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(256 * 1024)
    const bytes = readSync(fd, buf, 0, buf.length, 0)
    const text = buf.subarray(0, bytes).toString('utf8')
    let matched = false
    let title = ''
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line) as Record<string, unknown> & {
          type?: string
          cwd?: string
          summary?: string
          message?: { role?: string; content?: unknown }
          isMeta?: boolean
        }
        if (obj.cwd && norm(obj.cwd) === target) matched = true
        if (!title && obj.type === 'summary' && typeof obj.summary === 'string') title = obj.summary
        if (
          !title &&
          obj.type === 'user' &&
          !obj.isMeta &&
          obj.message?.role === 'user'
        ) {
          const c = obj.message.content
          let text: string | undefined
          if (typeof c === 'string') text = c
          else if (Array.isArray(c)) {
            const t = c.find((b) => (b as { type?: string })?.type === 'text') as
              | { text?: string }
              | undefined
            text = t?.text
          }
          if (text && !text.startsWith('<')) title = text.replace(/\s+/g, ' ').slice(0, 60)
        }
        if (matched && title) break
      } catch {
        /* 跳过解析失败的行 */
      }
    }
    if (!matched) return null
    const mtime = statSync(file).mtimeMs
    return {
      id,
      title: title || `会话 ${new Date(mtime).toLocaleString('zh-CN')}`,
      mtime
    }
  } catch {
    return null
  } finally {
    if (fd >= 0) closeSync(fd)
  }
}

/** 列出某文件夹的历史 Claude Code 会话(按最近修改排序,最多 20 条) */
export function listSessions(folder: string): SessionInfo[] {
  const root = join(homedir(), '.claude', 'projects')
  if (!existsSync(root)) return []
  const target = norm(folder)
  const out: SessionInfo[] = []
  for (const dir of readdirSync(root)) {
    const dirPath = join(root, dir)
    try {
      if (!statSync(dirPath).isDirectory()) continue
    } catch {
      continue
    }
    let files: string[] = []
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const full = join(dirPath, f)
      try {
        if (statSync(full).mtimeMs < Date.now() - 1000 * 60 * 60 * 24 * 60) continue // 60 天前的忽略
      } catch {
        continue
      }
      const info = probeSession(full, target)
      if (info) out.push(info)
    }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out.slice(0, 20)
}
