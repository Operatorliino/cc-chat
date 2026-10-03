import { useCallback, useEffect, useRef, useState } from 'react'
import { TerminalPane } from './components/TerminalPane'
import type { InitPayload, WindowSize } from '../../preload/api'

type LayoutMode = 'split' | 'chat' | 'term'

const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export default function App(): React.JSX.Element {
  const [init, setInit] = useState<InitPayload | null>(null)
  const [layout, setLayout] = useState<LayoutMode>('split')
  const [ratio, setRatio] = useState(0.46)
  const [folder, setFolder] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('选择一个文件夹,启动内嵌 Claude Code;左侧网页聊天处理简单问题。')
  const [chatUrl, setChatUrl] = useState('')

  const bodyRef = useRef<HTMLDivElement>(null)
  const chatPlaceholderRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const syncChatBounds = useCallback((): void => {
    const placeholder = chatPlaceholderRef.current
    if (!placeholder) return
    if (layout === 'term') {
      window.cc.setChatBounds(null)
      return
    }
    const rect = placeholder.getBoundingClientRect()
    window.cc.setChatBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }, [layout])

  useEffect(() => {
    void window.cc.getInit().then((payload) => {
      setInit(payload)
      setChatUrl(payload.chatUrl)
    })
  }, [])

  // 网页视图边界同步:布局/比例变化 + 窗口 resize + 占位元素尺寸观察(双保险)
  useEffect(() => {
    const raf = requestAnimationFrame(syncChatBounds)
    window.addEventListener('resize', syncChatBounds)
    const placeholder = chatPlaceholderRef.current
    let ro: ResizeObserver | null = null
    if (placeholder) {
      ro = new ResizeObserver(() => syncChatBounds())
      ro.observe(placeholder)
    }
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', syncChatBounds)
      ro?.disconnect()
    }
  }, [syncChatBounds, ratio, layout])

  useEffect(() => {
    return window.cc.onPty((ev) => {
      if (ev.type === 'started') {
        setRunning(true)
        setStatus(`claude 已在 ${folder ?? ''} 中启动`)
      } else if (ev.type === 'exit') {
        setRunning(false)
        setStatus(`claude 已退出(code=${ev.exitCode})`)
      } else if (ev.type === 'error') {
        setRunning(false)
        setStatus(ev.message)
      }
    })
  }, [folder])

  const pickAndStart = useCallback(async (): Promise<void> => {
    const picked = await window.cc.pickFolder()
    if (!picked) return
    setFolder(picked)
    const recent = await window.cc.addRecent(picked)
    setInit((prev) => (prev ? { ...prev, recentFolders: recent } : prev))
    setStatus(`正在启动 claude → ${picked}`)
    const result = await window.cc.startClaude(picked)
    if (!result.ok) setStatus(result.message)
  }, [])

  const startRecent = useCallback(async (f: string): Promise<void> => {
    setFolder(f)
    setStatus(`正在启动 claude → ${f}`)
    const result = await window.cc.startClaude(f)
    if (!result.ok) setStatus(result.message)
  }, [])

  const changeWindowSize = useCallback(
    (size: WindowSize): void => {
      setInit((prev) => (prev ? { ...prev, windowSize: size } : prev))
      void window.cc.setWindowSize(size).then(() => {
        // 主进程 setSize 后渲染进程尺寸更新有延迟,补偿同步两次
        setTimeout(syncChatBounds, 80)
        setTimeout(syncChatBounds, 300)
      })
    },
    [syncChatBounds]
  )

  const applyChatUrl = useCallback((): void => {
    void window.cc.setChatUrl(chatUrl).then((result) => {
      setStatus(result.ok ? `聊天页已切换 → ${chatUrl}` : (result.message ?? '切换失败'))
    })
  }, [chatUrl])

  const onDividerMouseDown = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    draggingRef.current = true
    const body = bodyRef.current
    if (!body) return
    const onMove = (me: MouseEvent): void => {
      if (!draggingRef.current) return
      const rect = body.getBoundingClientRect()
      const next = (me.clientX - rect.left) / rect.width
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)))
    }
    const onUp = (): void => {
      draggingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const chatWidth = layout === 'chat' ? '100%' : layout === 'term' ? '0' : `${ratio * 100}%`

  return (
    <div className="app">
      <header>
        <span className="logo">CC·Chat</span>
        <button className="btn primary" onClick={() => void pickAndStart()}>
          选择文件夹并启动 Claude Code
        </button>
        {init && init.recentFolders.length > 0 && (
          <select
            className="select"
            value=""
            onChange={(e) => {
              const f = e.target.value
              if (f) void startRecent(f)
            }}
          >
            <option value="" disabled>
              最近文件夹
            </option>
            {init.recentFolders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        {init && (
          <select
            className="select"
            value={init.windowSize}
            onChange={(e) => changeWindowSize(e.target.value as WindowSize)}
          >
            <option value="small">窗口:小</option>
            <option value="medium">窗口:中</option>
            <option value="large">窗口:大</option>
          </select>
        )}
        <div className="layout-toggle">
          {(
            [
              ['split', '双栏'],
              ['chat', '仅聊天'],
              ['term', '仅终端']
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              className={`btn toggle ${layout === mode ? 'active' : ''}`}
              onClick={() => setLayout(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="body" ref={bodyRef}>
        <section
          className="pane chat-pane"
          style={{ flexBasis: chatWidth, display: layout === 'term' ? 'none' : 'flex' }}
        >
          <div className="chat-placeholder" ref={chatPlaceholderRef}>
            <div className="chat-hint">网页聊天加载中…</div>
          </div>
        </section>
        {layout === 'split' && <div className="divider" onMouseDown={onDividerMouseDown} />}
        <section className="pane term-pane" style={{ display: layout === 'chat' ? 'none' : 'flex' }}>
          <div className="term-header">
            <span className="cwd" title={folder ?? ''}>
              {folder ?? '未选择文件夹'}
            </span>
            <span className="pill">{running ? '● 运行中' : '○ 未运行'}</span>
            {running && (
              <button className="btn danger" onClick={() => window.cc.stopClaude()}>
                停止
              </button>
            )}
          </div>
          <TerminalPane />
        </section>
      </div>

      <footer>
        <span className="footer-status">{status}</span>
        <input
          className="input url-input"
          placeholder="聊天页 URL(https://chatglm.cn)"
          value={chatUrl}
          onChange={(e) => setChatUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyChatUrl()
          }}
        />
        <button className="btn" onClick={applyChatUrl}>
          打开
        </button>
      </footer>
    </div>
  )
}
