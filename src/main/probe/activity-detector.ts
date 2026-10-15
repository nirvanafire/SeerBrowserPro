/**
 * 活动 Canvas 检测：间隔两次截图，对每个 canvas 的 CSS 区域做像素差分，
 * 变化像素占比最高者即"正在渲染的游戏 Canvas"。
 */
import type { WebContents } from 'electron'
import type { CanvasInfo, Rect } from '@shared/types'
import { captureView, type CaptureOutput } from '../capture/capturer'
import { cropCssRect } from '../capture/capturer'
import { scoreCanvas } from './canvas-prober'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 计算两张位图的变化像素比例（按 step 抽样，阈值判定） */
export function diffRatio(a: Buffer, b: Buffer, step = 3, threshold = 24): number {
  let changed = 0
  let total = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 4 * step) {
    const dr = Math.abs(a[i] - b[i])
    const dg = Math.abs(a[i + 1] - b[i + 1])
    const db = Math.abs(a[i + 2] - b[i + 2])
    if (dr + dg + db > threshold) changed++
    total++
  }
  return total > 0 ? changed / total : 0
}

export interface ActivityResult {
  canvases: CanvasInfo[]
  bestIndex: number
}

/**
 * @param intervalMs 两次截图间隔（游戏帧率相关，默认 350ms）
 */
export async function detectActiveCanvas(
  wc: WebContents,
  canvases: CanvasInfo[],
  cssWidth: number,
  cssHeight: number,
  intervalMs = 350
): Promise<ActivityResult> {
  if (canvases.length === 0) return { canvases, bestIndex: -1 }

  const first: CaptureOutput = await captureView(wc, cssWidth, cssHeight)
  await sleep(intervalMs)
  const second: CaptureOutput = await captureView(wc, cssWidth, cssHeight)

  // 与视口求交：iframe 内画布可能部分滚出屏幕，裁剪前先取交集避免越界
  const intersectViewport = (r: Rect): Rect | null => {
    const x1 = Math.max(0, r.x)
    const y1 = Math.max(0, r.y)
    const x2 = Math.min(cssWidth, r.x + r.width)
    const y2 = Math.min(cssHeight, r.y + r.height)
    return x2 - x1 > 4 && y2 - y1 > 4 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null
  }

  const scored = canvases.map((c) => {
    if (!c.visible) return { ...c, activity: 0, score: 0 }
    const rc = intersectViewport(c.rect)
    if (!rc) return { ...c, activity: 0, score: 0 }
    try {
      const cropA = cropCssRect(first, rc)
      const cropB = cropCssRect(second, rc)
      const activity = diffRatio(cropA.data, cropB.data)
      const withActivity = { ...c, activity }
      return { ...withActivity, score: scoreCanvas(withActivity, cssWidth, cssHeight) }
    } catch {
      return { ...c, score: scoreCanvas(c, cssWidth, cssHeight) }
    }
  })

  scored.sort((a, b) => b.score - a.score)
  // 恢复原始 index 顺序返回，但 bestIndex 指向评分最高者的原始 index
  // 注意：不同 frame 中的 canvas 可能有相同选择器，必须组合 framePath 匹配
  const keyOf = (c: CanvasInfo): string => `${c.framePath}|${c.selector}`
  const bestKey = scored[0] ? keyOf(scored[0]) : ''
  const ordered = canvases.map((orig) => {
    const s = scored.find((x) => keyOf(x) === keyOf(orig))
    return s ?? orig
  })
  const bestIndex = ordered.findIndex((c) => keyOf(c) === bestKey)
  return { canvases: ordered, bestIndex }
}
