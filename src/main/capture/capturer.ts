/**
 * 截图模块：对指定 WebContents 截取可视区域，解码为 RGBA 位图。
 * capturePage 返回 DPR 物理像素位图，CSS 尺寸由调用方（Tab 视图边界）提供。
 */
import type { WebContents } from 'electron'
import { PNG } from 'pngjs'
import type { RawBitmap } from '../vision/preprocess'
import { cropBitmap } from '../vision/preprocess'

export interface CaptureOutput {
  bitmap: RawBitmap
  /** 截图像素 / CSS 像素 的缩放比（通常等于 DPR） */
  scale: number
  cssWidth: number
  cssHeight: number
}

export async function captureView(
  wc: WebContents,
  cssWidth: number,
  cssHeight: number
): Promise<CaptureOutput> {
  const image = await wc.capturePage()
  if (image.isEmpty()) {
    throw new Error('截图为空：页面可能尚未加载完成或标签不可见')
  }
  const dataUrl = image.toDataURL()
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const png = PNG.sync.read(Buffer.from(base64, 'base64'))
  const bitmap: RawBitmap = { width: png.width, height: png.height, data: png.data }
  const scale = cssWidth > 0 ? bitmap.width / cssWidth : 1
  return { bitmap, scale, cssWidth, cssHeight }
}

/** 按 CSS 矩形从位图中裁剪（内部自动乘 scale） */
export function cropCssRect(
  cap: CaptureOutput,
  rect: { x: number; y: number; width: number; height: number }
): RawBitmap {
  const s = cap.scale
  return cropBitmap(
    cap.bitmap,
    rect.x * s,
    rect.y * s,
    rect.width * s,
    rect.height * s
  )
}
