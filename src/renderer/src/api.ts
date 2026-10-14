/** 渲染进程 → 主进程的类型化 IPC 封装 */
import { IPC } from '@shared/ipc'
import type {
  AutomationConfig,
  CachedPage,
  CanvasInfo,
  CanvasSelection,
  CaptureFrame,
  DatasetInfo as DatasetInfoType,
  DetectResult,
  GameModule,
  LogEntry,
  ModelManifest,
  TabInfo,
  TaskState,
  AnnotationBox
} from '@shared/types'

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return (await window.seer.invoke(channel, payload)) as T
}

export const api = {
  // tabs
  listTabs: () => invoke<TabInfo[]>(IPC.TabList),
  createTab: (url?: string) => invoke<TabInfo[]>(IPC.TabCreate, { url }),
  activateTab: (id: string) => invoke<TabInfo[]>(IPC.TabActivate, { id }),
  closeTab: (id: string) => invoke<TabInfo[]>(IPC.TabClose, { id }),
  navigate: (url: string) => invoke<void>(IPC.TabNavigate, { url }),
  back: () => invoke<void>(IPC.TabBack),
  forward: () => invoke<void>(IPC.TabForward),
  reload: () => invoke<void>(IPC.TabReload),
  stop: () => invoke<void>(IPC.TabStop),

  // probe
  probeCanvases: () =>
    invoke<{ canvases: CanvasInfo[]; bestIndex: number; selection: CanvasSelection | null }>(
      IPC.ProbeCanvas
    ),
  selectCanvas: (selection: CanvasSelection) => invoke<CanvasInfo | null>(IPC.ProbeSelect, { selection }),
  probeCurrent: () =>
    invoke<{ selection: CanvasSelection | null; canvases: CanvasInfo[] }>(IPC.ProbeCurrent),

  // detect
  captureFrame: () => invoke<CaptureFrame>(IPC.CaptureFrame),
  detectOnce: () => invoke<DetectResult>(IPC.DetectOnce),
  startLive: (intervalMs: number) => invoke<void>(IPC.DetectStart, { intervalMs }),
  stopLive: () => invoke<void>(IPC.DetectStop),
  clearOverlay: () => invoke<void>(IPC.OverlayClear),
  clickDetection: (index: number) => invoke<boolean>(IPC.ActionClickDetection, { index }),

  // models
  listModels: () =>
    invoke<{ models: ModelManifest[]; activeId: string | null; modelsDir: string }>(IPC.ModelList),
  importModel: () => invoke<ModelManifest | null>(IPC.ModelImport),
  selectModel: (id: string) => invoke<void>(IPC.ModelSelect, { id }),
  removeModel: (id: string) => invoke<void>(IPC.ModelRemove, { id }),
  updateModel: (
    id: string,
    patch: Partial<Pick<ModelManifest, 'confThreshold' | 'iouThreshold' | 'name' | 'head' | 'inputSize'>>
  ) => invoke<void>(IPC.ModelUpdate, { id, patch }),
  generateDummy: () => invoke<ModelManifest | null>(IPC.ModelGenerateDummy),
  fetchOfficial: () => invoke<ModelManifest | null>(IPC.ModelFetchOfficial),

  // cache
  listPages: () => invoke<CachedPage[]>(IPC.CacheListPages),
  saveDetectionModule: (detection: DetectResult['detections'][number]) =>
    invoke<CachedPage | null>(IPC.CacheSaveModule, { detection }),
  updateModule: (pageId: string, module: GameModule) =>
    invoke<CachedPage | null>(IPC.CacheUpdateModule, { pageId, module }),
  deleteModule: (pageId: string, moduleId: string) =>
    invoke<CachedPage | null>(IPC.CacheDeleteModule, { pageId, moduleId }),
  deletePage: (pageId: string) => invoke<void>(IPC.CacheDeletePage, { pageId }),

  // task
  startTask: (config: AutomationConfig) =>
    invoke<{ ok: boolean; error?: string }>(IPC.TaskStart, { config }),
  stopTask: () => invoke<void>(IPC.TaskStop),
  taskState: () => invoke<TaskState>(IPC.TaskState),

  // annotate
  saveAnnotations: (frame: CaptureFrame, boxes: AnnotationBox[]) =>
    invoke<DatasetInfoType>(IPC.AnnotateSave, {
      dataUrl: frame.dataUrl,
      cssWidth: frame.cssWidth,
      cssHeight: frame.cssHeight,
      boxes
    }),
  datasetInfo: () => invoke<DatasetInfoType>(IPC.DatasetInfo),
  openUserData: (target?: 'root' | 'models' | 'dataset' | 'cache') =>
    invoke<void>(IPC.ShellOpenUserData, { target: target ?? 'root' }),

  // logs
  listLogs: () => invoke<LogEntry[]>(IPC.LogList),

  // events
  on: window.seer.on
}

export type DatasetInfo = DatasetInfoType
