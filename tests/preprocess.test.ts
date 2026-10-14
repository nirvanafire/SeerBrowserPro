import { describe, it, expect } from 'vitest'
import { letterboxToNCHW, cropBitmap, grayThumbnail } from '../src/main/vision/preprocess'

function makeBitmap(w: number, h: number, fill: [number, number, number, number]): {
  width: number
  height: number
  data: Buffer
} {
  const data = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4)
  return { width: w, height: h, data }
}

describe('preprocess letterbox', () => {
  it('输出 NCHW 尺寸正确且灰边为 114/255', () => {
    const bm = makeBitmap(1280, 720, [200, 100, 50, 255])
    const r = letterboxToNCHW(bm, 640)
    expect(r.tensorData).toHaveLength(3 * 640 * 640)
    expect(r.gain).toBeCloseTo(0.5)
    expect(r.padX).toBe(0)
    expect(r.padY).toBe(140)
    // 左上角是灰边（R 通道）
    expect(r.tensorData[0]).toBeCloseTo(114 / 255, 3)
    // 图像区域中心像素 R=200/255
    const centerIdx = (140 + 180) * 640 + 320
    expect(r.tensorData[centerIdx]).toBeCloseTo(200 / 255, 2)
  })

  it('cropBitmap 裁剪尺寸与内容', () => {
    const bm = makeBitmap(4, 4, [10, 20, 30, 255])
    const crop = cropBitmap(bm, 1, 1, 2, 2)
    expect(crop.width).toBe(2)
    expect(crop.height).toBe(2)
    expect(crop.data[0]).toBe(10)
    expect(crop.data[2]).toBe(30)
  })

  it('grayThumbnail 尺寸', () => {
    const bm = makeBitmap(64, 48, [128, 128, 128, 255])
    const t = grayThumbnail(bm, 32, 32)
    expect(t).toHaveLength(1024)
    expect(Math.round(t[0])).toBe(128)
  })
})
