/**
 * IPC 处理器：渲染进程与主进程全部能力的唯一编排入口。
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { IPC } from '@shared/ipc'
import type {
  AnnotationBox,
  AutomationConfig,
  CachedPage,
  CanvasSelection,
  Detection,
  LogEntry,
  LogLevel,
  ModelManifest,
  TabInfo
} from '@shared/types'
import type { TabManager } from '../browser/tab-manager'
import { probeCanvases, probeBySelector } from '../probe/canvas-prober'
import { detectActiveCanvas } from '../probe/activity-detector'
import type { YoloEngine } from '../vision/yolo-engine'
import type { ModelManager } from '../vision/model-manager'
import { runPython } from '../vision/python-bridge'
import type { DetectService } from '../automation/detect-service'
import type { TaskRunner } from '../automation/task-runner'
import type { ModuleStore } from '../cache/module-store'
import { ModuleStore as ModuleStoreCtor } from '../cache/module-store'
import { collectPageIdentity, dHash } from '../cache/page-signature'
import { clearOverlay } from '../automation/overlay-injector'
import { performAction } from '../automation/human-input'
import { center } from '../vision/coords'
import { DatasetExporter } from '../annotate/dataset-export'

export interface Services {
  win: BrowserWindow
  tabs: TabManager
  models: ModelManager
  engine: YoloEngine
  detect: DetectService
  runner: TaskRunner
  store: ModuleStore
  dataset: DatasetExporter
}

class EventBus {
  private history: LogEntry[] = []

  constructor(private win: BrowserWindow) {}

  log(level: LogLevel, msg: string): void {
    const entry: LogEntry = { time: Date.now(), level, msg }
    this.history.push(entry)
    if (this.history.length > 500) this.history.shift()
    if (!this.win.isDestroyed()) this.win.webContents.send(IPC.EvtLog, entry)
  }

  recent(): LogEntry[] {
    return [...this.history]
  }
}

export function registerHandlers(s: Services): EventBus {
  const bus = new EventBus(s.win)
  const send = (channel: string, payload?: unknown): void => {
    if (!s.win.isDestroyed()) s.win.webContents.send(channel, payload)
  }

  const emitTabs = (): void => send(IPC.EvtTabs, s.tabs.list())
  const emitModels = (): void =>
    send(IPC.EvtModels, { models: s.models.list(), activeId: s.models.activeId() })
  const emitCache = (): void => send(IPC.EvtCache, s.store.listPages())
  const emitTask = (): void => send(IPC.EvtTask, s.runner.getState())

  s.tabs.onChange = emitTabs
  s.tabs.onEmergencyStop = () => {
    s.detect.stopContinuous()
    s.runner.stop('Escape 急停')
  }
  s.detect.onFrame = (r) => send(IPC.EvtDetect, r)
  s.detect.onLog = (level, msg) => bus.log(level, msg)
  s.runner.onLog = (level, msg) => bus.log(level, msg)
  s.runner.onState = () => emitTask()
  s.runner.onCacheChanged = emitCache
  s.runner.onFrame = (sense) => send(IPC.EvtDetect, sense.result)

  // ---------- 标签页 ----------
  ipcMain.handle(IPC.TabList, (): TabInfo[] => s.tabs.list())
  ipcMain.handle(IPC.TabCreate, (_e, payload?: { url?: string }) => {
    s.tabs.createTab(payload?.url)
    return s.tabs.list()
  })
  ipcMain.handle(IPC.TabActivate, (_e, payload: { id: string }) => {
    s.tabs.activate(payload.id)
    return s.tabs.list()
  })
  ipcMain.handle(IPC.TabClose, (_e, payload: { id: string }) => {
    s.tabs.close(payload.id)
    return s.tabs.list()
  })
  ipcMain.handle(IPC.TabNavigate, (_e, payload: { url: string }) => {
    s.tabs.navigate(payload.url)
  })
  ipcMain.handle(IPC.TabBack, () => s.tabs.back())
  ipcMain.handle(IPC.TabForward, () => s.tabs.forward())
  ipcMain.handle(IPC.TabReload, () => s.tabs.reload())
  ipcMain.handle(IPC.TabStop, () => s.tabs.stop())

  // ---------- Canvas 探测 ----------
  ipcMain.handle(IPC.ProbeCanvas, async () => {
    const tab = s.tabs.getActive()
    const bounds = s.tabs.getActiveBounds()
    if (!tab || !bounds) return { canvases: [], bestIndex: -1, selection: null }
    const raw = await probeCanvases(tab.view.webContents)
    const { canvases, bestIndex } = await detectActiveCanvas(
      tab.view.webContents,
      raw,
      bounds.width,
      bounds.height
    )
    s.detect.setProbeCache(tab.id, canvases)
    let selection = s.detect.getSelection(tab.id)
    if (!selection && bestIndex >= 0) {
      selection = { kind: 'index', index: canvases[bestIndex].index }
      s.detect.setSelection(tab.id, selection)
      bus.log('info', `自动选中活动 Canvas（评分 ${canvases[bestIndex].score}）`)
    }
    return { canvases, bestIndex, selection }
  })

  ipcMain.handle(IPC.ProbeSelect, async (_e, payload: { selection: CanvasSelection }) => {
    const tab = s.tabs.getActive()
    const bounds = s.tabs.getActiveBounds()
    if (!tab || !bounds) return null
    let info = null
    const selection: CanvasSelection = payload.selection
    if (selection.kind === 'index') {
      info = (await probeCanvases(tab.view.webContents)).find((c) => c.index === selection.index) ?? null
    } else {
      info = await probeBySelector(tab.view.webContents, selection.selector)
    }
    if (info) {
      s.detect.setSelection(tab.id, payload.selection)
      bus.log('info', `已指定 Canvas：${info.selector}`)
    } else {
      bus.log('error', '未找到该 Canvas，请检查选择器')
    }
    return info
  })

  ipcMain.handle(IPC.ProbeCurrent, () => {
    const tab = s.tabs.getActive()
    if (!tab) return { selection: null, canvases: [] }
    return {
      selection: s.detect.getSelection(tab.id),
      canvases: s.detect.getProbeCache(tab.id)
    }
  })

  // ---------- 截图 ----------
  ipcMain.handle(IPC.CaptureFrame, async () => {
    const tab = s.tabs.getActive()
    const bounds = s.tabs.getActiveBounds()
    if (!tab || !bounds) throw new Error('没有活动标签')
    const { captureView } = await import('../capture/capturer')
    const cap = await captureView(tab.view.webContents, bounds.width, bounds.height)
    const png = new PNG({ width: cap.bitmap.width, height: cap.bitmap.height })
    png.data = cap.bitmap.data
    const buf = PNG.sync.write(png)
    return {
      dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
      cssWidth: bounds.width,
      cssHeight: bounds.height,
      bitmapWidth: cap.bitmap.width,
      bitmapHeight: cap.bitmap.height
    }
  })

  // ---------- 推理 ----------
  ipcMain.handle(IPC.DetectOnce, async () => {
    try {
      return await s.detect.detectOnce()
    } catch (e) {
      bus.log('error', e instanceof Error ? e.message : String(e))
      throw e
    }
  })
  ipcMain.handle(IPC.DetectStart, (_e, payload: { intervalMs: number }) => {
    s.detect.startContinuous(payload.intervalMs ?? 1500)
    bus.log('info', `连续检测已开启（${payload.intervalMs ?? 1500}ms）`)
  })
  ipcMain.handle(IPC.DetectStop, () => {
    s.detect.stopContinuous()
    bus.log('info', '连续检测已停止')
  })
  ipcMain.handle(IPC.OverlayClear, async () => {
    const tab = s.tabs.getActive()
    if (tab) await clearOverlay(tab.view.webContents)
  })

  ipcMain.handle(IPC.ActionClickDetection, async (_e, payload: { index: number }) => {
    const sense = s.detect.lastSense
    const det = sense?.detections[payload.index]
    const bounds = s.tabs.getActiveBounds()
    const tab = s.tabs.getActive()
    if (!det || !bounds || !tab) return false
    const c = center(det.css)
    bus.log('action', `手动点击检测目标「${det.label}」@(${Math.round(c.x)},${Math.round(c.y)})`)
    await performAction(tab.view.webContents, 'click', c.x, c.y, bounds.width, bounds.height)
    return true
  })

  // ---------- 模型管理 ----------
  ipcMain.handle(IPC.ModelList, () => ({
    models: s.models.list(),
    activeId: s.models.activeId(),
    modelsDir: s.models.getModelsDir()
  }))

  ipcMain.handle(IPC.ModelImport, async () => {
    const res = await dialog.showOpenDialog(s.win, {
      title: '选择 YOLO26 ONNX 模型（可同时选择 classes.json）',
      filters: [{ name: '模型/类别', extensions: ['onnx', 'json'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const onnx = res.filePaths.find((p) => p.toLowerCase().endsWith('.onnx'))
    if (!onnx) {
      bus.log('error', '未选择 .onnx 文件')
      return null
    }
    const classesFile = res.filePaths.find((p) => p.toLowerCase().endsWith('.json'))
    const m = s.models.importModel({ onnxPath: onnx, classesPath: classesFile, head: 'auto' })
    bus.log('info', `模型已导入：${m.name}（${m.classes.length} 个类别）`)
    emitModels()
    return m
  })

  ipcMain.handle(IPC.ModelSelect, async (_e, payload: { id: string }) => {
    s.models.select(payload.id)
    s.engine.dispose()
    const m = s.models.getById(payload.id)
    if (m) bus.log('info', `切换模型：${m.name}`)
    emitModels()
  })

  ipcMain.handle(IPC.ModelRemove, (_e, payload: { id: string }) => {
    const active = s.models.getById(payload.id)
    s.models.remove(payload.id)
    if (active?.id === s.engine.current()?.id) s.engine.dispose()
    emitModels()
  })

  ipcMain.handle(
    IPC.ModelUpdate,
    (_e, payload: { id: string; patch: Partial<Pick<ModelManifest, 'confThreshold' | 'iouThreshold' | 'name' | 'head' | 'inputSize'>> }) => {
      s.models.update(payload.id, payload.patch)
      if (payload.id === s.models.activeId()) s.engine.dispose()
      emitModels()
    }
  )

  ipcMain.handle(IPC.ModelGenerateDummy, async () => {
    const outDir = join(s.models.getModelsDir(), 'dummy')
    const onnxPath = join(outDir, 'yolo26-dummy-e2e.onnx')
    bus.log('info', '生成离线演示模型（仅需 Python onnx 包）…')
    try {
      const r = await runPython('make_dummy_model.py', [onnxPath], (line) => {
        bus.log('info', '[py] ' + line)
        send(IPC.EvtPythonLog, line)
      })
      if (r.code !== 0) throw new Error(`脚本退出码 ${r.code}`)
      const classes = ['target', 'button', 'coin', 'dialog']
      const m = s.models.registerExisting({
        onnxPath,
        name: '离线演示模型(e2e)',
        classes,
        head: 'e2e',
        inputSize: 640,
        builtin: true
      })
      s.models.select(m.id)
      s.engine.dispose()
      bus.log('info', '演示模型就绪，可直接在「检测」面板使用')
      emitModels()
      return m
    } catch (e) {
      bus.log('error', `演示模型生成失败：${e instanceof Error ? e.message : String(e)}（可执行 pip install onnx 后重试）`)
      return null
    }
  })

  ipcMain.handle(IPC.ModelFetchOfficial, async () => {
    const outDir = join(s.models.getModelsDir(), 'official')
    bus.log('info', '通过 ultralytics 获取官方 yolo26n 并导出 ONNX（首次会下载 torch，体积较大）…')
    try {
      const r = await runPython('fetch_official.py', [outDir], (line) => {
        bus.log('info', '[py] ' + line)
        send(IPC.EvtPythonLog, line)
      })
      if (r.code !== 0) throw new Error(`脚本退出码 ${r.code}`)
      const onnxPath = join(outDir, 'yolo26n.onnx')
      const classesPath = join(outDir, 'classes.json')
      const m = s.models.importModel({
        onnxPath,
        classesPath,
        name: 'YOLO26n 官方(COCO)',
        head: 'e2e'
      })
      s.models.select(m.id)
      s.engine.dispose()
      bus.log('info', '官方模型已就绪')
      emitModels()
      return m
    } catch (e) {
      bus.log('error', `官方模型获取失败：${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  })

  // ---------- 缓存 ----------
  ipcMain.handle(IPC.CacheListPages, (): CachedPage[] => s.store.listPages())

  ipcMain.handle(IPC.CacheCurrent, async () => {
    const tab = s.tabs.getActive()
    if (!tab) return null
    const identity = await collectPageIdentity(tab.view.webContents)
    return { identity, match: s.store.matchPage(identity) }
  })

  ipcMain.handle(IPC.CacheSaveModule, async (_e, payload: { detection: Detection }) => {
    const tab = s.tabs.getActive()
    if (!tab) return null
    const identity = await collectPageIdentity(tab.view.webContents)
    const visualHash = s.detect.lastSense ? dHash(s.detect.lastSense.bitmap) : ''
    const page = s.store.getOrCreatePage({ ...identity, visualHash })
    const mod = ModuleStoreCtor.newModule({
      label: payload.detection.label,
      classId: payload.detection.classId,
      bboxViewportNorm: payload.detection.viewportNorm,
      bboxCanvasNorm: payload.detection.canvasNorm,
      confidence: payload.detection.confidence
    })
    const saved = s.store.upsertModule(page.id, mod)
    emitCache()
    bus.log('info', `功能模块已缓存：${mod.label}（页面 ${page.id}）`)
    return saved
  })

  ipcMain.handle(IPC.CacheUpdateModule, (_e, payload: { pageId: string; module: CachedPage['modules'][number] }) => {
    const saved = s.store.upsertModule(payload.pageId, payload.module)
    emitCache()
    return saved
  })
  ipcMain.handle(IPC.CacheDeleteModule, (_e, payload: { pageId: string; moduleId: string }) => {
    const saved = s.store.deleteModule(payload.pageId, payload.moduleId)
    emitCache()
    return saved
  })
  ipcMain.handle(IPC.CacheDeletePage, (_e, payload: { pageId: string }) => {
    s.store.deletePage(payload.pageId)
    emitCache()
  })

  // ---------- 自动化任务 ----------
  ipcMain.handle(IPC.TaskStart, async (_e, payload: { config: AutomationConfig }) => {
    if (s.runner.isRunning()) return { ok: false, error: '任务已在运行' }
    void s.runner.start(payload.config)
    return { ok: true }
  })
  ipcMain.handle(IPC.TaskStop, () => {
    s.runner.stop('用户点击停止')
  })
  ipcMain.handle(IPC.TaskState, () => s.runner.getState())

  // ---------- 标注 / 数据集 ----------
  ipcMain.handle(
    IPC.AnnotateSave,
    (_e, payload: { dataUrl: string; cssWidth: number; cssHeight: number; boxes: AnnotationBox[] }) => {
      if (payload.boxes.length === 0) {
        bus.log('warn', '没有标注框，未保存')
        return s.dataset.info()
      }
      const info = s.dataset.saveSample(payload)
      bus.log('info', `样本已保存（数据集共 ${info.sampleCount} 张，${info.classes.length} 个标签）`)
      return info
    }
  )
  ipcMain.handle(IPC.DatasetInfo, () => s.dataset.info())
  ipcMain.handle(IPC.ShellOpenUserData, async (_e, payload?: { target: 'models' | 'dataset' | 'cache' | 'root' }) => {
    const { app } = await import('electron')
    const base = app.getPath('userData')
    await shell.openPath(payload?.target ? join(base, payload.target) : base)
  })

  ipcMain.handle(IPC.LogList, () => bus.recent())

  // 初始事件
  emitModels()
  emitCache()
  emitTask()
  return bus
}
