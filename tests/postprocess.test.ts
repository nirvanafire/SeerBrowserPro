import { describe, it, expect } from 'vitest'
import {
  decodeAuto,
  decodeE2E,
  decodeStandard,
  detectHeadKind,
  iouBoxes
} from '../src/main/vision/postprocess'

const opts = { confThreshold: 0.5, iouThreshold: 0.6, inputSize: 640 }

describe('postprocess YOLO26 双路解码', () => {
  it('识别检测头类型', () => {
    expect(detectHeadKind([1, 300, 6])).toBe('e2e')
    expect(detectHeadKind([1, 84, 8400])).toBe('standard')
    expect(detectHeadKind([1, 12, 5376])).toBe('standard')
    // 非 e2e 结构且通道数 >= 锚点数（不像标准检测头）
    expect(detectHeadKind([1, 84, 84])).toBe('unknown')
  })

  it('e2e 头 (1,300,6)：过滤低置信度，保留 xyxy/score/class', () => {
    const data = new Float32Array(300 * 6)
    const set = (i: number, x1: number, y1: number, x2: number, y2: number, score: number, cls: number) => {
      data.set([x1, y1, x2, y2, score, cls], i * 6)
    }
    set(0, 10, 20, 110, 120, 0.95, 0)
    set(1, 200, 200, 300, 300, 0.8, 3)
    set(2, 5, 5, 50, 50, 0.3, 0) // 低置信度丢弃
    const dets = decodeE2E(data, [1, 300, 6], opts)
    expect(dets).toHaveLength(2)
    expect(dets[0].classId).toBe(0)
    expect(dets[0].confidence).toBeCloseTo(0.95, 5)
    expect(dets[0].box).toEqual({ x1: 10, y1: 20, x2: 110, y2: 120 })
    expect(dets[1].classId).toBe(3)
  })

  it('standard 头 (1,4+nc,8400)：cxcywh 转换 + 同类 NMS', () => {
    const anchors = 8400
    const nc = 2
    const data = new Float32Array((4 + nc) * anchors)
    const put = (a: number, cx: number, cy: number, w: number, h: number, cls: number, score: number) => {
      data[0 * anchors + a] = cx
      data[1 * anchors + a] = cy
      data[2 * anchors + a] = w
      data[3 * anchors + a] = h
      data[(4 + cls) * anchors + a] = score
    }
    // 同类两个高重叠框 -> NMS 只保留分数高的
    put(0, 100, 100, 40, 40, 0, 0.9)
    put(1, 102, 101, 40, 40, 0, 0.8)
    // 另一类的独立框
    put(2, 400, 400, 60, 60, 1, 0.7)
    // 低分类分数字段默认 0，不会入选
    const dets = decodeStandard(data, [1, 4 + nc, anchors], opts)
    expect(dets).toHaveLength(2)
    const cls0 = dets.find((d) => d.classId === 0)!
    const cls1 = dets.find((d) => d.classId === 1)!
    expect(cls0.confidence).toBeCloseTo(0.9, 5)
    expect(cls0.box).toEqual({ x1: 80, y1: 80, x2: 120, y2: 120 })
    expect(cls1.box).toEqual({ x1: 370, y1: 370, x2: 430, y2: 430 })
  })

  it('decodeAuto 自动分派', () => {
    const e2e = new Float32Array(300 * 6)
    e2e.set([0, 0, 10, 10, 0.99, 1], 0)
    const r1 = decodeAuto(e2e, [1, 300, 6], opts)
    expect(r1.kind).toBe('e2e')
    expect(r1.detections).toHaveLength(1)

    const unknown = new Float32Array(50 * 50)
    expect(() => decodeAuto(unknown, [1, 50, 50], opts)).toThrow(/无法识别/)
  })

  it('iouBoxes 正确性', () => {
    expect(iouBoxes({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 0, x2: 10, y2: 10 })).toBeCloseTo(1)
    expect(iouBoxes({ x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 1, y1: 1, x2: 3, y2: 3 })).toBeCloseTo(1 / 7)
  })
})
