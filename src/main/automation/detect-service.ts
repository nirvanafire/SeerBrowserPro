/**
 * 检测编排服务：截图 -> YOLO26 推理 -> 三级坐标换算 -> 覆盖层渲染。
 * 供「检测面板」的单次/连续检测与「任务执行器」共用。
 */
import type { BBox, CanvasInfo, CanvasSelection, DetectResult, Detection, Rect } from '@shared/types'
import type { TabManager } from '../browser/tab-manager'
import type { YoloEngine } from '../vision/yolo-engine'
import type { ModelManager } from '../vision/model-manager'
import { captureView, type CaptureOutput } from '../capture/capturer'
import { bitmapToCss, cssToViewportNorm, cssToCanvasNorm, clampBox } from '../vision/coords'
import { resolveSelectionRect } from '../probe/canvas-prober'
import type { RawBitmap } from '../vision/preprocess'
import { renderOverlay, clearOverlay } from './overlay-injector'

export interface SenseOutput {
  result: DetectResult
  bitmap: RawBitmap
  cap: CaptureOutput
  canvasRect: Rect | null
  detections: Detection[]
}

export class DetectService {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private selectionByTab = new Map<string, CanvasSelection>()
  private probeCacheByTab = new Map<string, CanvasInfo[]>()
  onFrame: ((r: DetectResult) => void) | null = null
  onLog: ((level: 'info' | 'warn' | 'error', msg: string) => void) | null = null
  /** 检测结果丰富化钩子：由 IPC 层注入，把检测结果与缓存功能点匹配（填充 moduleId/pageModules） */
  enricher: ((r: DetectResult) => Promise<void>) | null = null
  /** 最近一次感知结果（供"直接点击检测目标"等 IPC 使用） */
  lastSense: SenseOutput | null = null

  constructor(
    private tabs: TabManager,
    private engine: YoloEngine,
    private models: ModelManager
  ) {}

  setProbeCache(tabId: string, list: CanvasInfo[]): void {
    this.probeCacheByTab.set(tabId, list)
  }

  getProbeCache(tabId: string): CanvasInfo[] {
    return this.probeCacheByTab.get(tabId) ?? []
  }

  setSelection(tabId: string, selection: CanvasSelection | null): void {
    if (selection) this.selectionByTab.set(tabId, selection)
    else this.selectionByTab.delete(tabId)
  }

  getSelection(tabId: string): CanvasSelection | null {
    return this.selectionByTab.get(tabId) ?? null
  }

  /** 轻量查询当前所选 Canvas 的最新 CSS 矩形（每次截图前调用，兼容窗口缩放与 iframe 布局变化） */
  private async resolveCanvasRect(tabId: string): Promise<Rect | null> {
    const sel = this.selectionByTab.get(tabId)
    const tab = this.tabs.get(tabId)
    if (!sel || !tab) return null
    return resolveSelectionRect(
      tab.view.webContents,
      sel,
      this.probeCacheByTab.get(tabId) ?? []
    )
  }

  private buildDetections(
    rawBoxes: Array<{ classId: number; confidence: number; box: BBox }>,
    cap: CaptureOutput,
    classes: string[],
    canvasRect: Rect | null
  ): Detection[] {
    const { scale, cssWidth, cssHeight } = cap
    return rawBoxes.map((d) => {
      const css = clampBox(
        bitmapToCss(d.box, scale),
        0,
        0,
        cssWidth,
        cssHeight
      )
      return {
        classId: d.classId,
        label: classes[d.classId] ?? `class_${d.classId}`,
        confidence: d.confidence,
        bitmap: d.box,
        css,
        viewportNorm: cssToViewportNorm(css, cssWidth, cssHeight),
        canvasNorm: canvasRect ? cssToCanvasNorm(css, canvasRect) : null
      }
    })
  }

  async sense(showOverlay = true): Promise<SenseOutput> {
    const tab = this.tabs.getActive()
    const t0 = performance.now()
    if (!tab) throw new Error('没有活动标签页')
    const bounds = this.tabs.getActiveBounds()
    if (!bounds) throw new Error('标签视图未布局')

    const model = this.models.getActive()
    if (!model) {
      throw new Error('尚未选择模型：请在「模型」面板导入 YOLO26 ONNX，或生成离线演示模型')
    }
    if (!this.engine.isLoaded() || this.engine.current()?.id !== model.id) {
      this.onLog?.('info', `加载模型：${model.name}`)
      await this.engine.load(model)
    }

    const wc = tab.view.webContents
    const cap = await captureView(wc, bounds.width, bounds.height)
    const canvasRect = await this.resolveCanvasRect(tab.id)
    const out = await this.engine.infer(cap.bitmap, {
      confThreshold: model.confThreshold,
      iouThreshold: model.iouThreshold
    })
    const detections = this.buildDetections(out.detections, cap, model.classes, canvasRect)
    const totalMs = performance.now() - t0

    const result: DetectResult = {
      ok: true,
      inferenceMs: out.inferenceMs,
      totalMs,
      bitmapWidth: cap.bitmap.width,
      bitmapHeight: cap.bitmap.height,
      cssWidth: cap.cssWidth,
      cssHeight: cap.cssHeight,
      detections,
      modelName: model.name
    }
    // 功能点关联：命中缓存模块的检测框带上功能点名（覆盖层与面板同步显示）
    if (this.enricher) {
      try {
        await this.enricher(result)
      } catch {
        /* 丰富化失败不影响检测主流程 */
      }
    }

    if (showOverlay) {
      await renderOverlay(
        wc,
        detections.map((d) => ({
          ...d.css,
          label: d.moduleLabel ?? d.label,
          confidence: d.confidence,
          kind: 'detect' as const
        }))
      )
    }
    const sense: SenseOutput = { result, bitmap: cap.bitmap, cap, canvasRect, detections }
    this.lastSense = sense
    return sense
  }

  async detectOnce(): Promise<DetectResult> {
    const s = await this.sense(true)
    return s.result
  }

  startContinuous(intervalMs: number): void {
    if (this.timer) return
    this.runningSet(true)
    const tick = async (): Promise<void> => {
      if (this.busy) return
      this.busy = true
      try {
        const s = await this.sense(true)
        this.onFrame?.(s.result)
      } catch (e) {
        this.onLog?.('error', e instanceof Error ? e.message : String(e))
      } finally {
        this.busy = false
      }
    }
    void tick()
    this.timer = setInterval(() => void tick(), Math.max(300, intervalMs))
  }

  stopContinuous(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.runningSet(false)
    const tab = this.tabs.getActive()
    if (tab) void clearOverlay(tab.view.webContents)
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  private runningSet(_v: boolean): void {
    // 状态由 onFrame/外部 store 感知；保留接口便于扩展
  }
}
