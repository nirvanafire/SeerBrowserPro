/**
 * 运动区域检测（无需模型的功能点发现）：
 * 对同一视口的两次截图按网格做像素差分，把"变化网格"做连通域聚类，
 * 合并为候选包围盒。用于未训练模型时快速发现页面上的动态功能
 * （按钮动画、弹窗、奖励飘字等），结果可直接存为功能点并点击。
 */
import type { BBox } from '@shared/types'
import type { RawBitmap } from './preprocess'

export interface MotionOptions {
  /** 网格单元边长（bitmap 物理像素），越小定位越细但噪声越多 */
  cell?: number
  /** 单元平均通道差超过该阈值视为"变化" */
  threshold?: number
  /** 最小保留面积（bitmap 像素²） */
  minArea?: number
  /** 最多返回的候选框数量（按得分取前 N） */
  maxBoxes?: number
}

export interface MotionRegion {
  /** bitmap 物理像素坐标 */
  box: BBox
  /** 变化强度得分 0~1 */
  score: number
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * @param a 前一帧  @param b 后一帧（尺寸不同时按交集处理）
 * @returns 按得分降序的候选区域
 */
export function detectMotionRegions(
  a: RawBitmap,
  b: RawBitmap,
  opts: MotionOptions = {}
): MotionRegion[] {
  const cell = Math.max(8, opts.cell ?? 32)
  const threshold = opts.threshold ?? 18
  const minArea = opts.minArea ?? (cell * cell) / 2
  const maxBoxes = opts.maxBoxes ?? 12

  const w = Math.min(a.width, b.width)
  const h = Math.min(a.height, b.height)
  if (w < cell || h < cell) return []

  const gw = Math.floor(w / cell)
  const gh = Math.floor(h / cell)
  const diff = new Float32Array(gw * gh)
  const sampleStep = 2

  // 1) 网格差分：每单元内抽样像素求平均通道差
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0
      let n = 0
      for (let y = gy * cell; y < (gy + 1) * cell; y += sampleStep) {
        const rowA = y * a.width * 4
        const rowB = y * b.width * 4
        for (let x = gx * cell; x < (gx + 1) * cell; x += sampleStep) {
          const ia = rowA + x * 4
          const ib = rowB + x * 4
          sum +=
            (Math.abs(a.data[ia] - b.data[ib]) +
              Math.abs(a.data[ia + 1] - b.data[ib + 1]) +
              Math.abs(a.data[ia + 2] - b.data[ib + 2])) /
            3
          n++
        }
      }
      diff[gy * gw + gx] = n > 0 ? sum / n : 0
    }
  }

  // 2) 阈值命中 + 4 邻接连通域聚类
  const hot = new Uint8Array(gw * gh)
  for (let i = 0; i < diff.length; i++) hot[i] = diff[i] > threshold ? 1 : 0
  const visited = new Uint8Array(gw * gh)
  const queue: number[] = []
  const regions: MotionRegion[] = []

  for (let seed = 0; seed < hot.length; seed++) {
    if (!hot[seed] || visited[seed]) continue
    queue.length = 0
    queue.push(seed)
    visited[seed] = 1
    let minX = gw
    let minY = gh
    let maxX = -1
    let maxY = -1
    let cells = 0
    let scoreSum = 0
    while (queue.length > 0) {
      const cur = queue.pop() as number
      const cx = cur % gw
      const cy = (cur / gw) | 0
      cells++
      scoreSum += diff[cur]
      if (cx < minX) minX = cx
      if (cy < minY) minY = cy
      if (cx > maxX) maxX = cx
      if (cy > maxY) maxY = cy
      if (cx > 0 && hot[cur - 1] && !visited[cur - 1]) {
        visited[cur - 1] = 1
        queue.push(cur - 1)
      }
      if (cx < gw - 1 && hot[cur + 1] && !visited[cur + 1]) {
        visited[cur + 1] = 1
        queue.push(cur + 1)
      }
      if (cy > 0 && hot[cur - gw] && !visited[cur - gw]) {
        visited[cur - gw] = 1
        queue.push(cur - gw)
      }
      if (cy < gh - 1 && hot[cur + gw] && !visited[cur + gw]) {
        visited[cur + gw] = 1
        queue.push(cur + gw)
      }
    }
    const box: BBox = {
      x1: minX * cell,
      y1: minY * cell,
      x2: (maxX + 1) * cell,
      y2: (maxY + 1) * cell
    }
    const area = (box.x2 - box.x1) * (box.y2 - box.y1)
    if (area < minArea) continue
    // 平均差 60 视为强变化（经验值），归一化到 0~1
    regions.push({ box, score: clamp01(scoreSum / cells / 60) })
  }

  regions.sort((p, q) => q.score - p.score)
  return regions.slice(0, maxBoxes)
}
