import { contextBridge, ipcRenderer } from 'electron'
import type { ChatBounds, CcApi, PtyEvent, WindowSize } from './api'

const api: CcApi = {
  getInit: () => ipcRenderer.invoke('app:init'),
  setWindowSize: (size: WindowSize) => ipcRenderer.invoke('win:setSize', size),
  setChatUrl: (url: string) => ipcRenderer.invoke('chat:setUrl', url),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  setChatBounds: (rect: ChatBounds | null) => ipcRenderer.send('chat:bounds', rect),
  addRecent: (folder: string) => ipcRenderer.invoke('store:addRecent', folder),
  startClaude: (folder: string) => ipcRenderer.invoke('pty:start', folder),
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
