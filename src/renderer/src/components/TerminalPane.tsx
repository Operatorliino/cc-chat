import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export function TerminalPane(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#111114',
        foreground: '#e6e6e9',
        cursor: '#4f8cff'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      /* 容器尺寸为 0 时忽略 */
    }
    term.writeln('\x1b[36m[CC Chat] 选择文件夹后自动在此启动 claude\x1b[0m')

    term.onData((data) => window.cc.ptyInput(data))

    const offPty = window.cc.onPty((ev) => {
      if (ev.type === 'data') term.write(ev.data)
      else if (ev.type === 'exit') term.write(`\r\n\x1b[33m[claude 已退出, code=${ev.exitCode}]\x1b[0m\r\n`)
      else if (ev.type === 'error') term.write(`\r\n\x1b[31m[错误] ${ev.message}\x1b[0m\r\n`)
    })

    const ro = new ResizeObserver(() => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return
      try {
        fit.fit()
        window.cc.ptyResize(term.cols, term.rows)
      } catch {
        /* 忽略拟合失败 */
      }
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      offPty()
      term.dispose()
    }
  }, [])

  return <div ref={hostRef} className="term-host" />
}
