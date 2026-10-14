/**
 * 模板校验：无模型或模型漏检时，用功能模块存储的 32x32 灰度缩略图
 * 与当前画面裁剪块做归一化互相关（NCC），判断模块是否仍在原处。
 */
import type { RawBitmap } from '../vision/preprocess'
import { grayThumbnail } from '../vision/preprocess'

export function normalizedCrossCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma
    const xb = b[i] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  const denom = Math.sqrt(da * db)
  return denom > 1e-6 ? num / denom : 0
}

/** 取当前裁剪区域的缩略图，与存储模板比对，返回 -1~1（>0.6 视为同一 UI） */
export function verifyAgainstTemplate(crop: RawBitmap, template: number[]): number {
  if (!template || template.length === 0) return 0
  const side = Math.round(Math.sqrt(template.length))
  if (side * side !== template.length || crop.width < 4 || crop.height < 4) return 0
  const current = grayThumbnail(crop, side, side)
  return normalizedCrossCorrelation(template, current)
}
