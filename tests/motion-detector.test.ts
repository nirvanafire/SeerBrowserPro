import { describe, expect, it } from 'vitest'
import { detectMotionRegions } from '../src/main/vision/motion-detector'
import type { RawBitmap } from '../src/main/vision/preprocess'

function solidBitmap(w: number, h: number, gray: number): RawBitmap {
  const data = Buffer.alloc(w * h * 4)
  data.fill(gray)
  return { width: w, height: h, data }
}

/** 在位图上画一个实心矩形（RGB 同值） */
function fillRect(bm: RawBitmap, x1: number, y1: number, x2: number, y2: number, gray: number): void {
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * bm.width + x) * 4
      bm.data[i] = gray
      bm.data[i + 1] = gray
      bm.data[i + 2] = gray
      bm.data[i + 3] = 255
    }
  }
}

describe('detectMotionRegions', () => {
  it('两帧完全一致时无运动区域', () => {
    const a = solidBitmap(256, 256, 40)
    const b = solidBitmap(256, 256, 40)
    expect(detectMotionRegions(a, b)).toEqual([])
  })

  it('发现的区域覆盖发生变化的矩形', () => {
    const a = solidBitmap(256, 256, 40)
    const b = solidBitmap(256, 256, 40)
    // 变化矩形 (48,48)-(112,112)：跨越 grid 单元，强对比
    fillRect(b, 48, 48, 112, 112, 220)
    const regions = detectMotionRegions(a, b, { cell: 32, threshold: 18 })
    expect(regions.length).toBe(1)
    const r = regions[0]
    // 网格化后的框应包住变化区域（cell=32 对齐扩展）
    expect(r.box.x1).toBeLessThanOrEqual(48)
    expect(r.box.y1).toBeLessThanOrEqual(48)
    expect(r.box.x2).toBeGreaterThanOrEqual(112)
    expect(r.box.y2).toBeGreaterThanOrEqual(112)
    expect(r.score).toBeGreaterThan(0)
  })

  it('两处独立变化产生两个区域，按得分降序', () => {
    const a = solidBitmap(320, 160, 0)
    const b = solidBitmap(320, 160, 0)
    fillRect(b, 16, 16, 80, 80, 255) // 强变化
    fillRect(b, 200, 90, 232, 122, 40) // 弱变化（灰度差 40）
    const regions = detectMotionRegions(a, b, { cell: 16, threshold: 18 })
    expect(regions.length).toBe(2)
    // 强变化区域得分更高排在前面
    expect(regions[0].score).toBeGreaterThanOrEqual(regions[1].score)
  })

  it('maxBoxes 限制返回数量', () => {
    const a = solidBitmap(320, 320, 0)
    const b = solidBitmap(320, 320, 0)
    // 撒 4 个互不相邻的变化块
    fillRect(b, 10, 10, 42, 42, 255)
    fillRect(b, 100, 10, 132, 42, 255)
    fillRect(b, 200, 10, 232, 42, 255)
    fillRect(b, 10, 200, 42, 232, 255)
    const regions = detectMotionRegions(a, b, { cell: 16, maxBoxes: 3 })
    expect(regions.length).toBe(3)
  })

  it('尺寸不足一个网格时返回空', () => {
    const a = solidBitmap(16, 16, 0)
    const b = solidBitmap(16, 16, 255)
    expect(detectMotionRegions(a, b, { cell: 32 })).toEqual([])
  })
})
