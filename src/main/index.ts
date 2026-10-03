import { app, BrowserWindow, dialog, ipcMain, shell, WebContentsView } from 'electron'
import { join } from 'node:path'
import { addRecentFolder, loadSettings, saveSettings, setFolderModel, DEFAULT_CHAT_URL, type WindowSize } from './store'
import { PtyManager, type PtyEvent } from './pty'
import { listSessions } from './sessions'

const WINDOW_PRESETS: Record<WindowSize, { w: number; h: number; label: string }> = {
  small: { w: 1100, h: 720, label: '小' },
  medium: { w: 1280, h: 800, label: '中' },
  large: { w: 1536, h: 960, label: '大' }
}

const CHAT_ZOOM = 0.75

let win: BrowserWindow | null = null
let chatView: WebContentsView | null = null
const pty = new PtyManager()

/** 页面加载后自动点击侧边栏"收起"按钮(启发式:找不到就放弃,不影响使用) */
function autoCollapseSidebar(view: WebContentsView): void {
  const script = `(function attempt(n){
    if (n <= 0) return 'giveup'
    const els = Array.from(document.querySelectorAll('button,[role="button"],[aria-label],[title]'))
    const target = els.find((b) => {
      const s = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')).trim()
      return s.length < 30 && /收起|折叠|collapse|sidebar/i.test(s)
    })
    if (target) { target.click(); return 'clicked' }
    setTimeout(() => attempt(n - 1), 1200)
    return 'retry'
  })(4)`
  const delays = [1200, 3200]
  for (const d of delays) {
    setTimeout(() => {
      if (view.webContents.isDestroyed()) return
      void view.webContents
        .executeJavaScript(script, true)
        .catch(() => undefined)
    }, d)
  }
}

function createWindow(): void {
  const preset = WINDOW_PRESETS[loadSettings().windowSize]
  win = new BrowserWindow({
    width: preset.w,
    height: preset.h,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141414',
    title: 'CC Chat · 双引擎学习工作台',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

function ensureChatView(): WebContentsView {
  if (!chatView) {
    chatView = new WebContentsView({
      webPreferences: {
        partition: 'persist:chatglm',
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    chatView.setBackgroundColor('#ffffff')
    chatView.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    chatView.webContents.on('did-finish-load', () => {
      chatView?.webContents.setZoomFactor(CHAT_ZOOM)
      autoCollapseSidebar(chatView as WebContentsView)
    })
    chatView.webContents.setZoomFactor(CHAT_ZOOM)
    void chatView.webContents.loadURL(loadSettings().chatUrl || DEFAULT_CHAT_URL)
  }
  return chatView
}

function registerIpc(): void {
  ipcMain.handle('app:init', () => {
    const s = loadSettings()
    return {
      recentFolders: s.recentFolders,
      windowSize: s.windowSize,
      chatUrl: s.chatUrl,
      folderModels: s.folderModels
    }
  })

  ipcMain.handle('sessions:list', (_e, folder: string) => {
    return listSessions(folder)
  })

  ipcMain.handle('store:setFolderModel', (_e, payload: { folder: string; model: string }) => {
    setFolderModel(payload.folder, payload.model)
    return { ok: true }
  })

  ipcMain.handle('chat:setUrl', (_e, url: string) => {
    const clean = url.trim()
    if (!/^https?:\/\//i.test(clean)) return { ok: false, message: 'URL 需以 http(s):// 开头' }
    const settings = loadSettings()
    saveSettings({ ...settings, chatUrl: clean })
    if (chatView) void chatView.webContents.loadURL(clean)
    else ensureChatView()
    return { ok: true }
  })

  ipcMain.handle('win:setSize', (_e, size: WindowSize) => {
    const preset = WINDOW_PRESETS[size]
    if (!preset || !win) return { ok: false }
    const settings = loadSettings()
    saveSettings({ ...settings, windowSize: size })
    win.setSize(preset.w, preset.h)
    return { ok: true }
  })

  ipcMain.handle('dialog:pickFolder', async () => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择要在其中运行 Claude Code 的文件夹'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.on('chat:bounds', (_e, rect: { x: number; y: number; width: number; height: number } | null) => {
    if (!win) return
    if (!rect) {
      if (chatView && win.contentView.children.includes(chatView)) {
        win.contentView.removeChildView(chatView)
      }
      return
    }
    const view = ensureChatView()
    if (!win.contentView.children.includes(view)) win.contentView.addChildView(view)
    view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    })
  })

  ipcMain.on('chat:close', () => {
    if (!chatView) return
    if (win && win.contentView.children.includes(chatView)) {
      win.contentView.removeChildView(chatView)
    }
    try {
      chatView.webContents.close()
    } catch {
      /* 已销毁则忽略 */
    }
    chatView = null
  })

  ipcMain.handle('store:addRecent', (_e, folder: string) => {
    return addRecentFolder(folder)
  })

  const emit = (ev: PtyEvent): void => {
    void win?.webContents.send('pty:event', ev)
  }

  ipcMain.handle(
    'pty:start',
    (_e, payload: { folder: string; model?: string; resumeId?: string }) => {
      return pty.start(
        payload.folder,
        { model: payload.model, resumeId: payload.resumeId },
        emit
      )
    }
  )

  ipcMain.on('pty:input', (_e, data: string) => {
    pty.input(data)
  })

  ipcMain.on('pty:resize', (_e, dims: { cols: number; rows: number }) => {
    pty.resize(dims.cols, dims.rows)
  })

  ipcMain.on('pty:stop', () => {
    pty.stop()
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  pty.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  pty.stop()
})
