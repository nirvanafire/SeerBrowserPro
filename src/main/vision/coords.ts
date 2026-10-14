/**
 * 统一坐标契约（全项目唯一坐标换算入口，禁止在各模块内各算各的）：
 *
 *   bitmap 物理截图像素
 *     --(letterbox 逆变换 gain/pad)--> 模型输入坐标(640)
 *     --(/captureScale)--> css 视口坐标（sendInputEvent 使用）
 *       --(/canvasRect)--> canvasNorm 相对 Canvas 归一化坐标（缓存持久化）
 *       --(/viewportSize)--> viewportNorm 视口归一化坐标（缓存持久化）
 */
import type { BBox, Rect } from '@shared/types'

export interface Point {
  x: number
  y: number
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function clampBox(b: BBox, minX = 0, minY = 0, maxX = Infinity, maxY = Infinity): BBox {
  return {
    x1: clamp(b.x1, minX, maxX),
    y1: clamp(b.y1, minY, maxY),
    x2: clamp(b.x2, minX, maxX),
    y2: clamp(b.y2, minY, maxY)
  }
}

export function center(b: BBox): Point {
  return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }
}

export function scaleBox(b: BBox, sx: number, sy: number): BBox {
  return { x1: b.x1 * sx, y1: b.y1 * sy, x2: b.x2 * sx, y2: b.y2 * sy }
}

export function intersects(a: BBox, b: BBox): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
}

export function iou(a: BBox, b: BBox): number {
  if (!intersects(a, b)) return 0
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1)
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}

/** 中心归一化距离（0=重合，1=对角距离），用于 IoU 失效时的兜底匹配 */
export function centerDistance(a: BBox, b: BBox): number {
  const ca = center(a)
  const cb = center(b)
  const dx = (ca.x - cb.x) / ((a.x2 - a.x1 + b.x2 - b.x1) / 2 || 1)
  const dy = (ca.y - cb.y) / ((a.y2 - a.y1 + b.y2 - b.y1) / 2 || 1)
  return Math.hypot(dx, dy)
}

// ---------- 模型输入(letterboxed) → bitmap ----------

export function inverseLetterbox(b: BBox, gain: number, padX: number, padY: number): BBox {
  return {
    x1: (b.x1 - padX) / gain,
    y1: (b.y1 - padY) / gain,
    x2: (b.x2 - padX) / gain,
    y2: (b.y2 - padY) / gain
  }
}

// ---------- bitmap ↔ css ----------

export function bitmapToCss(b: BBox, scale: number): BBox {
  return scaleBox(b, 1 / scale, 1 / scale)
}

export function cssToBitmap(b: BBox, scale: number): BBox {
  return scaleBox(b, scale, scale)
}

// ---------- css ↔ viewportNorm ----------

export function cssToViewportNorm(b: BBox, cssW: number, cssH: number): BBox {
  return scaleBox(b, 1 / cssW, 1 / cssH)
}

export function viewportNormToCss(n: BBox, cssW: number, cssH: number): BBox {
  return scaleBox(n, cssW, cssH)
}

// ---------- css ↔ canvasNorm ----------

export function cssToCanvasNorm(b: BBox, canvasRectCss: Rect): BBox {
  return {
    x1: (b.x1 - canvasRectCss.x) / canvasRectCss.width,
    y1: (b.y1 - canvasRectCss.y) / canvasRectCss.height,
    x2: (b.x2 - canvasRectCss.x) / canvasRectCss.width,
    y2: (b.y2 - canvasRectCss.y) / canvasRectCss.height
  }
}

export function canvasNormToCss(n: BBox, canvasRectCss: Rect): BBox {
  return {
    x1: canvasRectCss.x + n.x1 * canvasRectCss.width,
    y1: canvasRectCss.y + n.y1 * canvasRectCss.height,
    x2: canvasRectCss.x + n.x2 * canvasRectCss.width,
    y2: canvasRectCss.y + n.y2 * canvasRectCss.height
  }
}

/**
 * 还原功能模块的当前可点击 CSS 包围盒：
 * 优先使用 Canvas 归一化坐标（随 Canvas 位置/分辨率自适应），
 * 其次回退到视口归一化坐标。
 */
export function resolveModuleBox(
  module: { bboxCanvasNorm: BBox | null; bboxViewportNorm: BBox },
  canvasRectCss: Rect | null,
  cssW: number,
  cssH: number
): BBox {
  if (module.bboxCanvasNorm && canvasRectCss) {
    return canvasNormToCss(module.bboxCanvasNorm, canvasRectCss)
  }
  return viewportNormToCss(module.bboxViewportNorm, cssW, cssH)
}

/** FNV-1a 字符串哈希 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
