/**
 * SeerBrowserPro 主进程 / 渲染进程共享类型定义
 * 所有坐标结构遵循统一坐标契约（见 docs/开发清单.md）：
 * bitmap(物理截图像素) -> css(视口 CSS 像素) -> canvasNorm(相对 Canvas 0~1)
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface BBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

// ---------- 浏览器标签 ----------

export interface TabInfo {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

// ---------- Canvas 探测 ----------

export interface CanvasInfo {
  index: number
  /** Canvas 在其所在 document 内的 CSS 选择器 */
  selector: string
  /** 所在 frame 路径：'top' 或 'top › iframe[2]' 等（含嵌套链） */
  framePath: string
  /** 所在 frame 的 URL */
  frameUrl: string
  id: string
  className: string
  /** '2d' | 'webgl' | 'webgl2' | 'webgpu' | 'unknown' */
  contextType: string
  /** Canvas backing store 像素宽 */
  width: number
  /** Canvas backing store 像素高 */
  height: number
  /** 相对顶层视口的 CSS 矩形（iframe 内 Canvas 已叠加祖先 iframe 偏移） */
  rect: Rect
  visible: boolean
  /** 双帧差分变化率 0~1 */
  activity: number
  /** 综合候选评分 0~1 */
  score: number
}

export type CanvasSelection =
  | { kind: 'index'; index: number }
  | { kind: 'selector'; selector: string }

// ---------- YOLO 模型 ----------

export type YoloHeadKind = 'auto' | 'e2e' | 'standard'

export interface ModelManifest {
  id: string
  name: string
  /** 绝对路径 */
  onnxPath: string
  classesPath?: string
  classes: string[]
  inputSize: number
  head: YoloHeadKind
  confThreshold: number
  iouThreshold: number
  builtin: boolean
  createdAt: number
}

// ---------- 检测结果 ----------

export interface Detection {
  classId: number
  label: string
  confidence: number
  /** 截图物理像素坐标 */
  bitmap: BBox
  /** CSS 视口坐标（sendInputEvent 使用） */
  css: BBox
  /** 相对所选 Canvas 的归一化坐标（0~1），未选择 Canvas 时为 null */
  canvasNorm: BBox | null
  /** 相对视口的归一化坐标（0~1，缓存使用） */
  viewportNorm: BBox
  /** 命中的缓存功能点 id（未命中为 undefined） */
  moduleId?: string
  /** 命中的功能点名（= 模块 label） */
  moduleLabel?: string
  /** 功能点累计命中次数 */
  moduleHits?: number
}

export interface DetectResult {
  ok: boolean
  error?: string
  inferenceMs: number
  totalMs: number
  bitmapWidth: number
  bitmapHeight: number
  cssWidth: number
  cssHeight: number
  detections: Detection[]
  modelName?: string
  /** 当前页缓存页 id（无匹配缓存时为 undefined） */
  pageId?: string
  /** 当前页已缓存的功能点清单（含本轮未命中的），供检测面板分组展示 */
  pageModules?: GameModule[]
}

// ---------- 功能模块缓存 ----------

export type ActionType = 'click' | 'dblclick' | 'rightclick' | 'drag'

export interface GameModule {
  id: string
  label: string
  classId: number
  action: ActionType
  /** 相对 Canvas 的归一化包围盒（跨分辨率鲁棒），无 Canvas 时为 null */
  bboxCanvasNorm: BBox | null
  /** 相对视口的归一化包围盒 */
  bboxViewportNorm: BBox
  /** 32x32 灰度缩略图（模板校验用，0~255） */
  template: number[]
  confidence: number
  locked: boolean
  hitCount: number
  lastSeen: number
  note?: string
}

export interface PageSignature {
  origin: string
  pathPattern: string
  title: string
  domHash: string
  visualHash: string
}

export interface CachedPage {
  id: string
  signature: PageSignature
  modules: GameModule[]
  createdAt: number
  updatedAt: number
}

// ---------- 自动化任务 ----------

export type TaskStep =
  | { type: 'click'; target: string; waitAfter?: number }
  | { type: 'clickPoint'; xNorm: number; yNorm: number; waitAfter?: number }
  | { type: 'waitFor'; target: string; timeout?: number }
  | { type: 'wait'; ms: number }
  | { type: 'verify'; target: string; timeout?: number }

export interface AutomationConfig {
  /** loop = 按标签循环点击；sequence = 按步骤序列执行 */
  mode: 'loop' | 'sequence'
  clickLabels: string[]
  stopLabel?: string
  steps: TaskStep[]
  loop: boolean
  maxLoops: number
  tickIntervalMs: number
  confidence: number
  dryRun: boolean
}

export interface TaskState {
  running: boolean
  loopCount: number
  tickCount: number
  lastAction: string
  startedAt: number | null
}

// ---------- 日志 / 标注 ----------

export type LogLevel = 'info' | 'warn' | 'error' | 'action'

export interface LogEntry {
  time: number
  level: LogLevel
  msg: string
}

export interface AnnotationBox {
  label: string
  /** CSS 视口坐标 */
  css: BBox
}

export interface CaptureFrame {
  dataUrl: string
  cssWidth: number
  cssHeight: number
  bitmapWidth: number
  bitmapHeight: number
}

/** 标注数据集统计信息（dataset-export 与渲染层共享） */
export interface DatasetInfo {
  root: string
  classes: string[]
  sampleCount: number
}
