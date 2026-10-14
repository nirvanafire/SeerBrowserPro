import { create } from 'zustand'
import { IPC } from '@shared/ipc'
import type {
  CachedPage,
  CanvasInfo,
  CanvasSelection,
  CaptureFrame,
  DetectResult,
  LogEntry,
  ModelManifest,
  TabInfo,
  TaskState,
  DatasetInfo
} from '@shared/types'
import { api } from './api'

export type PanelKey = 'canvas' | 'detect' | 'model' | 'cache' | 'task' | 'annotate' | 'log'

interface AppState {
  ready: boolean
  tabs: TabInfo[]
  activeTabId: string | null
  urlDraft: string

  panel: PanelKey
  canvases: CanvasInfo[]
  bestIndex: number
  canvasSelection: CanvasSelection | null

  detect: DetectResult | null
  live: boolean
  liveInterval: number

  models: ModelManifest[]
  activeModelId: string | null
  modelsDir: string

  pages: CachedPage[]

  task: TaskState
  dataset: DatasetInfo | null

  logs: LogEntry[]

  setPanel: (p: PanelKey) => void
  setUrlDraft: (s: string) => void
  setTabs: (tabs: TabInfo[]) => void
  setCanvases: (c: CanvasInfo[], best: number, sel: CanvasSelection | null) => void
  setCanvasSelection: (s: CanvasSelection | null) => void
  setDetect: (r: DetectResult) => void
  setLive: (v: boolean) => void
  setModels: (models: ModelManifest[], activeId: string | null, dir: string) => void
  setPages: (p: CachedPage[]) => void
  setTask: (t: TaskState) => void
  setDataset: (d: DatasetInfo) => void
  appendLog: (l: LogEntry) => void
  init: () => () => void
  refresh: () => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  tabs: [],
  activeTabId: null,
  urlDraft: '',

  panel: 'canvas',
  canvases: [],
  bestIndex: -1,
  canvasSelection: null,

  detect: null,
  live: false,
  liveInterval: 1500,

  models: [],
  activeModelId: null,
  modelsDir: '',

  pages: [],

  task: { running: false, loopCount: 0, tickCount: 0, lastAction: '', startedAt: null },
  dataset: null,

  logs: [],

  setPanel: (panel) => set({ panel }),
  setUrlDraft: (urlDraft) => set({ urlDraft }),
  setTabs: (tabs) => {
    const active = tabs.find((t) => t.url) ?? tabs[tabs.length - 1]
    set((s) => ({
      tabs,
      activeTabId: active?.id ?? s.activeTabId,
      urlDraft: active ? active.url : s.urlDraft
    }))
  },
  setCanvases: (canvases, bestIndex, canvasSelection) =>
    set({ canvases, bestIndex, canvasSelection }),
  setCanvasSelection: (canvasSelection) => set({ canvasSelection }),
  setDetect: (detect) => set({ detect }),
  setLive: (live) => set({ live }),
  setModels: (models, activeModelId, modelsDir) => set({ models, activeModelId, modelsDir }),
  setPages: (pages) => set({ pages }),
  setTask: (task) => set({ task }),
  setDataset: (dataset) => set({ dataset }),
  appendLog: (l) =>
    set((s) => ({ logs: [...s.logs.slice(-299), l] })),

  init: () => {
    const offs = [
      api.on(IPC.EvtTabs, (payload) => {
        get().setTabs(payload as TabInfo[])
      }),
      api.on(IPC.EvtDetect, (payload) => {
        get().setDetect(payload as DetectResult)
      }),
      api.on(IPC.EvtModels, (payload) => {
        const p = payload as { models: ModelManifest[]; activeId: string | null }
        get().setModels(p.models, p.activeId, get().modelsDir)
      }),
      api.on(IPC.EvtCache, (payload) => {
        get().setPages(payload as CachedPage[])
      }),
      api.on(IPC.EvtTask, (payload) => {
        get().setTask(payload as TaskState)
      }),
      api.on(IPC.EvtLog, (payload) => {
        get().appendLog(payload as LogEntry)
      })
    ]
    void get().refresh()
    api.listLogs().then((logs) => set({ logs: logs.slice(-300), ready: true }))
    return () => offs.forEach((off) => off())
  },

  refresh: async () => {
    const [tabs, models, pages] = await Promise.all([
      api.listTabs(),
      api.listModels(),
      api.listPages()
    ])
    get().setTabs(tabs)
    get().setModels(models.models, models.activeId, models.modelsDir)
    get().setPages(pages)
    set({ ready: true })
  }
}))

export type { CaptureFrame }
