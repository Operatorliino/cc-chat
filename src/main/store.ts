import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type WindowSize = 'small' | 'medium' | 'large'

export interface AppSettings {
  recentFolders: string[]
  windowSize: WindowSize
  chatUrl: string
  folderModels: Record<string, string>
}

export const DEFAULT_CHAT_URL = 'https://chatglm.cn/'

const DEFAULTS: AppSettings = {
  recentFolders: [],
  windowSize: 'medium',
  chatUrl: DEFAULT_CHAT_URL,
  folderModels: {}
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<AppSettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: AppSettings): void {
  const file = settingsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8')
}

export function addRecentFolder(folder: string): string[] {
  const s = loadSettings()
  const next = [folder, ...s.recentFolders.filter((f) => f !== folder)].slice(0, 8)
  saveSettings({ ...s, recentFolders: next })
  return next
}

export function setFolderModel(folder: string, model: string): void {
  const s = loadSettings()
  saveSettings({ ...s, folderModels: { ...s.folderModels, [folder]: model } })
}
