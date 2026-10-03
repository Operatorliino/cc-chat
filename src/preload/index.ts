import { contextBridge, ipcRenderer } from 'electron'
import type { ChatBounds, CcApi, PtyEvent, StartClaudeOptions, WindowSize } from './api'

const api: CcApi = {
  getInit: () => ipcRenderer.invoke('app:init'),
  setWindowSize: (size: WindowSize) => ipcRenderer.invoke('win:setSize', size),
  setChatUrl: (url: string) => ipcRenderer.invoke('chat:setUrl', url),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  setChatBounds: (rect: ChatBounds | null) => ipcRenderer.send('chat:bounds', rect),
  closeChat: () => ipcRenderer.send('chat:close'),
  addRecent: (folder: string) => ipcRenderer.invoke('store:addRecent', folder),
  startClaude: (folder: string, opts?: StartClaudeOptions) =>
    ipcRenderer.invoke('pty:start', { folder, ...opts }),
  listSessions: (folder: string) => ipcRenderer.invoke('sessions:list', folder),
  setFolderModel: (folder: string, model: string) =>
    ipcRenderer.invoke('store:setFolderModel', { folder, model }),
  stopClaude: () => ipcRenderer.send('pty:stop'),
  ptyInput: (data: string) => ipcRenderer.send('pty:input', data),
  ptyResize: (cols: number, rows: number) => ipcRenderer.send('pty:resize', { cols, rows }),
  onPty: (cb: (ev: PtyEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: PtyEvent): void => cb(ev)
    ipcRenderer.on('pty:event', listener)
    return () => {
      ipcRenderer.removeListener('pty:event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('cc', api)
