import { useCallback, useEffect, useRef, useState } from 'react'
import { TerminalPane } from './components/TerminalPane'
import type { InitPayload, SessionInfo, WindowSize } from '../../preload/api'

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [model, setModel] = useState('deepseek-chat')
  const [sessions, setSessions] = useState<SessionInfo[]>([])

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
  }, [syncChatBounds, ratio, layout, settingsOpen])

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
    const m = init?.folderModels[picked] ?? 'deepseek-chat'
    setModel(m)
    void window.cc.listSessions(picked).then(setSessions)
    const recent = await window.cc.addRecent(picked)
    setInit((prev) => (prev ? { ...prev, recentFolders: recent } : prev))
    setStatus(`正在启动 claude → ${picked}`)
    const result = await window.cc.startClaude(picked, { model: m })
    if (!result.ok) setStatus(result.message)
  }, [init])

  const startRecent = useCallback(
    async (f: string): Promise<void> => {
      setFolder(f)
      const m = init?.folderModels[f] ?? 'deepseek-chat'
      setModel(m)
      void window.cc.listSessions(f).then(setSessions)
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

  const resumeSession = useCallback(
    (id: string): void => {
      if (!folder) return
      setStatus(`恢复会话 ${id.slice(0, 8)}…`)
      void window.cc.startClaude(folder, { resumeId: id, model })
    },
    [folder, model]
  )

  const changeWindowSize = useCallback((size: WindowSize): void => {
    setInit((prev) => (prev ? { ...prev, windowSize: size } : prev))
    void window.cc.setWindowSize(size)
  }, [])

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
        <div className="layout-toggle">
          {(
            [
              ['split', '双栏'],
              ['chat', '聊天'],
              ['term', '终端']
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
              onChange={(e) => changeWindowSize(e.target.value as WindowSize)}
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
          <span className="settings-note">登录状态按域名分别记忆,改 URL 不影响已登录的站</span>
        </div>
      )}

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
            <span className={`pill ${running ? 'on' : ''}`}>{running ? '运行中' : '未运行'}</span>
            <span className="spacer" />
            {folder && (
              <>
                <select
                  className="select"
                  value={model}
                  title="模型:运行中=热切换(等同 /model,上下文保留);未运行=下次启动默认"
                  onChange={(e) => changeModel(e.target.value)}
                >
                  <option value="deepseek-chat">deepseek-chat</option>
                  <option value="deepseek-reasoner">deepseek-reasoner</option>
                </select>
                {sessions.length > 0 && (
                  <select
                    className="select"
                    value=""
                    title="恢复历史会话"
                    onChange={(e) => {
                      const id = e.target.value
                      if (id) resumeSession(id)
                    }}
                  >
                    <option value="" disabled>
                      历史会话({sessions.length})
                    </option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                )}
                {running && (
                  <button
                    className="btn"
                    title="中断当前任务(Esc),会话保留"
                    onClick={() => window.cc.ptyInput('\x1b')}
                  >
                    中断
                  </button>
                )}
              </>
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
