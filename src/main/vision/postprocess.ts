/**
 * YOLO26 双路后处理：
 * 1. e2e 一对一头（nms=False 导出）：输出 (batch, 300, 6) = x1,y1,x2,y2,score,classId，无需 NMS
 * 2. standard 一对多头（默认导出）：输出 (batch, 4+nc, 8400)，cx,cy,w,h + 各类别分数，需要 NMS
 *
 * 坐标均为 letterbox 后的模型输入坐标系，由调用方做 inverseLetterbox 还原。
 */
import type { BBox } from '@shared/types'
import { clamp } from './coords'

export interface RawDetection {
  classId: number
  confidence: number
  box: BBox
}

export interface DecodeOptions {
  confThreshold: number
  iouThreshold: number
  inputSize: number
}

/** 根据 ONNX 输出维度推断检测头类型 */
export function detectHeadKind(dims: number[]): 'e2e' | 'standard' | 'unknown' {
  // e2e: [batch, 300, 6]
  if (dims.length === 3 && dims[2] === 6 && dims[1] !== 6) return 'e2e'
  // standard: [batch, 4+nc, anchors]，通道数远小于锚点数
  if (dims.length === 3 && dims[1] < dims[2] && dims[1] >= 5) return 'standard'
  return 'unknown'
}

/** 解码端到端一对一头 (N, 300, 6) */
export function decodeE2E(
  data: Float32Array,
  dims: number[],
  opts: DecodeOptions
): RawDetection[] {
  const [, maxDet, step] = dims
  if (step !== 6) {
    throw new Error(`e2e 头最后一维应为 6，实际为 ${step}`)
  }
  const out: RawDetection[] = []
  for (let i = 0; i < maxDet; i++) {
    const o = i * 6
    const score = data[o + 4]
    if (score < opts.confThreshold) continue
    const classId = Math.round(data[o + 5])
    out.push({
      classId,
      confidence: score,
      box: {
        x1: data[o],
        y1: data[o + 1],
        x2: data[o + 2],
        y2: data[o + 3]
      }
    })
  }
  return out
}

/** 解码标准一对多头 (N, 4+nc, anchors) */
export function decodeStandard(
  data: Float32Array,
  dims: number[],
  opts: DecodeOptions
): RawDetection[] {
  const channels = dims[1]
  const anchors = dims[2]
  const numClasses = channels - 4
  if (numClasses <= 0) {
    throw new Error(`标准头通道数异常: ${channels}`)
  }

  const candidates: RawDetection[] = []
  for (let a = 0; a < anchors; a++) {
    let classId = -1
    let maxScore = opts.confThreshold
    for (let c = 0; c < numClasses; c++) {
      const s = data[(4 + c) * anchors + a]
      if (s > maxScore) {
        maxScore = s
        classId = c
      }
    }
    if (classId < 0) continue
    const cx = data[0 * anchors + a]
    const cy = data[1 * anchors + a]
    const w = data[2 * anchors + a]
    const h = data[3 * anchors + a]
    candidates.push({
      classId,
      confidence: maxScore,
      box: {
        x1: cx - w / 2,
        y1: cy - h / 2,
        x2: cx + w / 2,
        y2: cy + h / 2
      }
    })
  }

  // 按类别做 NMS
  const kept: RawDetection[] = []
  const byClass = new Map<number, RawDetection[]>()
  for (const d of candidates) {
    const list = byClass.get(d.classId) ?? []
    list.push(d)
    byClass.set(d.classId, list)
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => b.confidence - a.confidence)
    while (list.length > 0) {
      const best = list.shift()!
      kept.push(best)
      for (let i = list.length - 1; i >= 0; i--) {
        if (iouBoxes(best.box, list[i].box) > opts.iouThreshold) {
          list.splice(i, 1)
        }
      }
    }
  }
  return kept
}

/** 自动识别输出格式并解码 */
export function decodeAuto(
  data: Float32Array,
  dims: number[],
  opts: DecodeOptions
): { kind: 'e2e' | 'standard'; detections: RawDetection[] } {
  const kind = detectHeadKind(dims)
  if (kind === 'e2e') return { kind, detections: decodeE2E(data, dims, opts) }
  if (kind === 'standard') return { kind, detections: decodeStandard(data, dims, opts) }
  throw new Error(`无法识别的模型输出维度: [${dims.join(',')}]，请在模型配置中显式指定检测头类型`)
}

export function iouBoxes(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  const interW = Math.max(0, x2 - x1)
  const interH = Math.max(0, y2 - y1)
  const inter = interW * interH
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1)
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}

/** 将框限制在输入画布范围内 */
export function clipToInput(d: RawDetection, size: number): RawDetection {
  return {
    ...d,
    box: {
      x1: clamp(d.box.x1, 0, size),
      y1: clamp(d.box.y1, 0, size),
      x2: clamp(d.box.x2, 0, size),
      y2: clamp(d.box.y2, 0, size)
    }
  }
}
