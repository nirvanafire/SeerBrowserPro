/**
 * 检测结果 ↔ 缓存功能模块匹配器：
 * - 同 classId 且视口归一化 IoU≥0.3 → 更新已有模块（坐标跟随、命中计数+1）
 * - 否则按中心距离兜底
 * - 高置信度但无对应模块 → 自动登记新模块（可在缓存面板锁定/删除）
 */
import type { Detection, GameModule } from '@shared/types'
import { iou, centerDistance } from '../vision/coords'
import { ModuleStore } from '../cache/module-store'

export interface MatchPair {
  module: GameModule
  detection: Detection | null
  isNew: boolean
}

export interface MatchResult {
  pairs: MatchPair[]
  /** 未被本轮检测命中的旧模块（可能已消失） */
  missing: GameModule[]
}

const IOU_MATCH = 0.3
const CENTER_MATCH = 0.6
/** 自动登记新模块的置信度门槛 */
export const ENROLL_CONFIDENCE = 0.5

export function matchDetectionsToModules(
  detections: Detection[],
  existing: GameModule[],
  enroll: boolean,
  makeTemplate?: (d: Detection) => number[]
): MatchResult {
  const remaining = new Set(existing)
  const pairs: MatchPair[] = []

  for (const det of detections) {
    let best: GameModule | null = null
    let bestScore = 0
    for (const mod of remaining) {
      if (mod.classId !== det.classId) continue
      const score = iou(mod.bboxViewportNorm, det.viewportNorm)
      if (score > IOU_MATCH && score > bestScore) {
        best = mod
        bestScore = score
      }
    }
    if (!best) {
      // 中心距离兜底（UI 元素轻微位移）
      let bestDist = CENTER_MATCH
      for (const mod of remaining) {
        if (mod.classId !== det.classId) continue
        const d = centerDistance(mod.bboxViewportNorm, det.viewportNorm)
        if (d < bestDist) {
          best = mod
          bestDist = d
        }
      }
    }

    if (best) {
      remaining.delete(best)
      const updated: GameModule = best.locked
        ? { ...best, lastSeen: Date.now() }
        : {
            ...best,
            bboxViewportNorm: det.viewportNorm,
            bboxCanvasNorm: det.canvasNorm ?? best.bboxCanvasNorm,
            confidence: Math.max(best.confidence, det.confidence),
            hitCount: best.hitCount + 1,
            lastSeen: Date.now(),
            template: makeTemplate?.(det) ?? best.template
          }
      pairs.push({ module: updated, detection: det, isNew: false })
    } else if (enroll && det.confidence >= ENROLL_CONFIDENCE) {
      const created = ModuleStore.newModule({
        label: det.label,
        classId: det.classId,
        bboxViewportNorm: det.viewportNorm,
        bboxCanvasNorm: det.canvasNorm,
        confidence: det.confidence,
        template: makeTemplate?.(det) ?? [],
        hitCount: 1
      })
      pairs.push({ module: created, detection: det, isNew: true })
    }
  }

  return { pairs, missing: Array.from(remaining) }
}
