import { describe, it, expect } from 'vitest'
import {
  bitmapToCss,
  cssToBitmap,
  canvasNormToCss,
  cssToCanvasNorm,
  cssToViewportNorm,
  inverseLetterbox,
  iou,
  resolveModuleBox,
  viewportNormToCss,
  fnv1a
} from '../src/main/vision/coords'

describe('coords 坐标契约', () => {
  it('bitmap<->css 往返一致（DPR=1.5）', () => {
    const scale = 1.5
    const box = { x1: 150, y1: 300, x2: 450, y2: 600 }
    const css = bitmapToCss(box, scale)
    expect(css).toEqual({ x1: 100, y1: 200, x2: 300, y2: 400 })
    expect(cssToBitmap(css, scale)).toEqual(box)
  })

  it('css<->viewportNorm 往返一致', () => {
    const css = { x1: 100, y1: 200, x2: 300, y2: 400 }
    const n = cssToViewportNorm(css, 1000, 800)
    expect(n.x1).toBeCloseTo(0.1)
    expect(n.y1).toBeCloseTo(0.25)
    expect(viewportNormToCss(n, 1000, 800)).toEqual(css)
  })

  it('css<->canvasNorm 往返一致（考虑 canvas 在页面中的偏移）', () => {
    const canvasRect = { x: 40, y: 120, width: 900, height: 600 }
    const css = { x1: 130, y1: 240, x2: 490, y2: 600 }
    const n = cssToCanvasNorm(css, canvasRect)
    expect(n.x1).toBeCloseTo(0.1)
    expect(n.y1).toBeCloseTo(0.2)
    const back = canvasNormToCss(n, canvasRect)
    expect(back.x1).toBeCloseTo(130)
    expect(back.y1).toBeCloseTo(240)
  })

  it('inverseLetterbox 还原 letterbox 坐标', () => {
    // 1280x720 缩入 640：gain=0.5, padX=0, padY=140
    const gain = 0.5
    const lb = { x1: 100, y1: 140 + 50, x2: 300, y2: 140 + 250 }
    const bm = inverseLetterbox(lb, gain, 0, 140)
    expect(bm).toEqual({ x1: 200, y1: 100, x2: 600, y2: 500 })
  })

  it('iou 基本性质', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    expect(iou(a, a)).toBeCloseTo(1)
    expect(iou(a, { x1: 20, y1: 20, x2: 30, y2: 30 })).toBe(0)
    // 交集 50 / 并集 150
    expect(iou(a, { x1: 5, y1: 0, x2: 15, y2: 10 })).toBeCloseTo(1 / 3)
  })

  it('resolveModuleBox 优先使用 canvasNorm 并回退 viewportNorm', () => {
    const canvasRect = { x: 0, y: 84, width: 1040, height: 716 }
    const viaCanvas = resolveModuleBox(
      { bboxCanvasNorm: { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }, bboxViewportNorm: { x1: 0, y1: 0, x2: 1, y2: 1 } },
      canvasRect,
      1040,
      800
    )
    expect(viaCanvas.x1).toBeCloseTo(104)
    expect(viaCanvas.y1).toBeCloseTo(84 + 71.6)

    const viaViewport = resolveModuleBox(
      { bboxCanvasNorm: null, bboxViewportNorm: { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 } },
      canvasRect,
      1000,
      800
    )
    expect(viaViewport.x1).toBeCloseTo(100)
  })

  it('fnv1a 稳定输出 8 位 hex', () => {
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1a('hello')).toBe(fnv1a('hello'))
    expect(fnv1a('a')).not.toBe(fnv1a('b'))
  })
})
