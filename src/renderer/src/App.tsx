import { useCallback, useEffect, useRef, useState } from 'react'
import { TerminalPane } from './components/TerminalPane'
import type { InitPayload, WindowSize } from '../../preload/api'

const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

/** 模型选项:用 CC 别名(sonnet/opus),由 ~/.claude/settings.json 的 ANTHROPIC_DEFAULT_*_MODEL 解析成实际模型 */
const MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'sonnet', label: 'flash(快)' },
  { value: 'opus', label: 'v4-pro(强)' }
]

const normalizeModel = (m: string): string =>
  m === 'deepseek-chat' ? 'sonnet' : m === 'deepseek-reasoner' ? 'opus' : m

type WebState = 'closed' | 'open' | 'collapsed'

export default function App(): React.JSX.Element {
  const [init, setInit] = useState<InitPayload | null>(null)
  const [webState, setWebState] = useState<WebState>('closed')
  const [ratio, setRatio] = useState(0.46)
  const [folder, setFolder] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('选择一个文件夹,启动内嵌 Claude Code;需要网页聊天时点右上角"网页窗口"。')
  const [chatUrl, setChatUrl] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [model, setModel] = useState('opus')

  const bodyRef = useRef<HTMLDivElement>(null)
  const chatPlaceholderRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const syncChatBounds = useCallback((): void => {
    // closed = 视图已销毁;collapsed = 视图保留在后台(登录态/页面不丢),仅从窗口分离
    if (webState !== 'open') {
      window.cc.setChatBounds(null)
      return
    }
    const placeholder = chatPlaceholderRef.current
    if (!placeholder) return
    const rect = placeholder.getBoundingClientRect()
    window.cc.setChatBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }, [webState])

  useEffect(() => {
    void window.cc.getInit().then((payload) => {
      setInit(payload)
      setChatUrl(payload.chatUrl)
    })
  }, [])

  // 网页视图边界同步:布局/比例变化 + 窗口 resize + 占位元素尺寸观察 + 设置条开合
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
  }, [syncChatBounds, ratio, webState, settingsOpen])

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
    const m = normalizeModel(init?.folderModels[picked] ?? 'opus')
    setModel(m)
    const recent = await window.cc.addRecent(picked)
    setInit((prev) => (prev ? { ...prev, recentFolders: recent } : prev))
    setStatus(`正在启动 claude → ${picked}`)
    const result = await window.cc.startClaude(picked, { model: m })
    if (!result.ok) setStatus(result.message)
  }, [init])

  const startRecent = useCallback(
    async (f: string): Promise<void> => {
      setFolder(f)
      const m = normalizeModel(init?.folderModels[f] ?? 'opus')
      setModel(m)
      setStatus(`正在启动 claude → ${f}`)
      const result = await window.cc.startClaude(f, { model: m })
      if (!result.ok) setStatus(result.message)
    },
    [init]
  )

  const changeModel = useCallback(
    (m: string): void => {
      setModel(m)
      if (!folder) return
      void window.cc.setFolderModel(folder, m)
      if (running) {
        // 热切换:把 /model 打进正在运行的 claude,不丢会话上下文
        window.cc.ptyInput(`/model ${m}\r`)
        setStatus(`已热切换模型 → ${m}(当前会话上下文保留)`)
      } else {
        setStatus(`模型默认 → ${m}(下次启动 claude 生效)`)
      }
    },
    [folder, running]
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

  const showWeb = webState !== 'closed'
  const chatWidth = webState === 'open' ? `${ratio * 100}%` : '0'

  return (
    <div className="app">
      <header>
        <span className="logo">CC·Chat</span>
        <button className="btn primary" onClick={() => void pickAndStart()}>
          启动 Claude Code
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
              最近
            </option>
            {init.recentFolders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        {webState === 'closed' ? (
          <button className="btn" onClick={() => setWebState('open')}>
            网页窗口
          </button>
        ) : (
          <>
            <button
              className="btn"
              onClick={() => setWebState(webState === 'open' ? 'collapsed' : 'open')}
            >
              {webState === 'open' ? '收起网页' : '展开网页'}
            </button>
            <button
              className="btn"
              onClick={() => {
                window.cc.closeChat()
                setWebState('closed')
              }}
            >
              关闭网页
            </button>
          </>
        )}
        <button
          className={`btn gear ${settingsOpen ? 'active' : ''}`}
          title="设置"
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          ⚙
        </button>
      </header>

      {settingsOpen && (
        <div className="settings-strip">
          <label>
            窗口
            <select
              className="select"
              value={init?.windowSize ?? 'medium'}
              onChange={(e) => {
                const size = e.target.value as WindowSize
                setInit((prev) => (prev ? { ...prev, windowSize: size } : prev))
                void window.cc.setWindowSize(size)
              }}
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </label>
          <label className="grow">
            聊天页 URL
            <input
              className="input"
              value={chatUrl}
              onChange={(e) => setChatUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyChatUrl()
              }}
              placeholder="https://chatglm.cn"
            />
          </label>
          <button className="btn" onClick={applyChatUrl}>
            应用
          </button>
        </div>
      )}

      <div className="body" ref={bodyRef}>
        {showWeb && (
          <>
            <section className="pane chat-pane" style={{ flexBasis: chatWidth }}>
              <div className="chat-placeholder" ref={chatPlaceholderRef}>
                <div className="chat-hint">网页聊天加载中…</div>
              </div>
            </section>
            {webState === 'open' && <div className="divider" onMouseDown={onDividerMouseDown} />}
          </>
        )}
        <section className="pane term-pane">
          <div className="term-header">
            <span className="cwd" title={folder ?? ''}>
              {folder ?? '未选择文件夹'}
            </span>
            <span className={`pill ${running ? 'on' : ''}`}>{running ? '运行中' : '未运行'}</span>
            {folder && (
              <select
                className="select"
                value={model}
                title="模型:运行中=热切换(/model,上下文保留);未运行=下次启动默认"
                onChange={(e) => changeModel(e.target.value)}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {running && (
              <button className="btn danger" title="结束进程" onClick={() => window.cc.stopClaude()}>
                退出
              </button>
            )}
          </div>
          <TerminalPane />
          {!folder && (
            <div className="term-empty">
              <span className="title">从一个文件夹开始</span>
              <span>点击上方"启动 Claude Code",内嵌终端会自动运行</span>
            </div>
          )}
        </section>
      </div>

      <footer>{status}</footer>
    </div>
  )
}
