/**
 * YOLO 输入预处理：RGBA 位图 -> letterbox(保持长宽比, 灰边填充) -> RGB NCHW float32 /255
 */

export interface RawBitmap {
  width: number
  height: number
  /** RGBA，每像素 4 字节 */
  data: Buffer
}

export interface LetterboxResult {
  /** NCHW float32，长度 3*size*size */
  tensorData: Float32Array
  gain: number
  padX: number
  padY: number
  size: number
}

/** 双线性采样单个像素（RGBA） */
function sampleBilinear(bm: RawBitmap, fx: number, fy: number): [number, number, number] {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(bm.width - 1, x0 + 1)
  const y1 = Math.min(bm.height - 1, y0 + 1)
  const wx = fx - x0
  const wy = fy - y0
  const idx = (x: number, y: number) => (y * bm.width + x) * 4
  const p00 = idx(x0, y0)
  const p10 = idx(x1, y0)
  const p01 = idx(x0, y1)
  const p11 = idx(x1, y1)
  const d = bm.data
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const top = d[p00 + c] * (1 - wx) + d[p10 + c] * wx
    const bot = d[p01 + c] * (1 - wx) + d[p11 + c] * wx
    out[c] = top * (1 - wy) + bot * wy
  }
  return out
}

/**
 * letterbox 预处理。
 * @param bm 原始 RGBA 位图
 * @param size 模型输入边长（通常 640）
 * @param fill 填充色（YOLO 惯例 114）
 * @param out 可选复用的输出缓冲（长度须为 3*size*size），避免连续推理时反复分配大数组
 */
export function letterboxToNCHW(
  bm: RawBitmap,
  size = 640,
  fill = 114,
  out?: Float32Array
): LetterboxResult {
  const gain = Math.min(size / bm.width, size / bm.height)
  const resizedW = Math.round(bm.width * gain)
  const resizedH = Math.round(bm.height * gain)
  const padX = Math.floor((size - resizedW) / 2)
  const padY = Math.floor((size - resizedH) / 2)

  const planeSize = size * size
  const tensorData =
    out && out.length === 3 * planeSize ? out : new Float32Array(3 * planeSize)
  // 先铺灰边
  const fillNorm = fill / 255
  tensorData.fill(fillNorm)

  const channelStride = planeSize
  for (let y = 0; y < resizedH; y++) {
    const fy = y / gain
    for (let x = 0; x < resizedW; x++) {
      const fx = x / gain
      const [r, g, b] = sampleBilinear(bm, fx, fy)
      const dstIdx = (y + padY) * size + (x + padX)
      tensorData[dstIdx] = r / 255
      tensorData[channelStride + dstIdx] = g / 255
      tensorData[2 * channelStride + dstIdx] = b / 255
    }
  }

  return { tensorData, gain, padX, padY, size }
}

/** 裁剪 RGBA 位图 */
export function cropBitmap(
  bm: RawBitmap,
  x: number,
  y: number,
  w: number,
  h: number
): RawBitmap {
  const cx = Math.max(0, Math.round(x))
  const cy = Math.max(0, Math.round(y))
  const cw = Math.min(bm.width - cx, Math.round(w))
  const ch = Math.min(bm.height - cy, Math.round(h))
  const data = Buffer.alloc(cw * ch * 4)
  for (let row = 0; row < ch; row++) {
    const srcStart = ((cy + row) * bm.width + cx) * 4
    bm.data.copy(data, row * cw * 4, srcStart, srcStart + cw * 4)
  }
  return { width: cw, height: ch, data }
}

/** 区域平均灰度 */
export function regionMeanGray(bm: RawBitmap, step = 4): number {
  let sum = 0
  let count = 0
  for (let y = 0; y < bm.height; y += step) {
    for (let x = 0; x < bm.width; x += step) {
      const i = (y * bm.width + x) * 4
      sum += 0.299 * bm.data[i] + 0.587 * bm.data[i + 1] + 0.114 * bm.data[i + 2]
      count++
    }
  }
  return count > 0 ? sum / count : 0
}

/**
 * 生成缩略图灰度数组（最近邻采样），用于模块模板校验。
 * 返回 length = gridW*gridH 的 0~255 灰度值。
 */
export function grayThumbnail(bm: RawBitmap, gridW = 32, gridH = 32): number[] {
  const out: number[] = new Array(gridW * gridH)
  for (let gy = 0; gy < gridH; gy++) {
    const sy = Math.min(bm.height - 1, Math.floor(((gy + 0.5) / gridH) * bm.height))
    for (let gx = 0; gx < gridW; gx++) {
      const sx = Math.min(bm.width - 1, Math.floor(((gx + 0.5) / gridW) * bm.width))
      const i = (sy * bm.width + sx) * 4
      out[gy * gridW + gx] = Math.round(
        0.299 * bm.data[i] + 0.587 * bm.data[i + 1] + 0.114 * bm.data[i + 2]
      )
    }
  }
  return out
}
