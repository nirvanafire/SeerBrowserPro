/**
 * 标注数据集导出：人工框选结果保存为 YOLO 检测格式
 *   dataset/images/<ts>.png
 *   dataset/labels/<ts>.txt   每行: classIndex cx cy w h（均相对整图归一化）
 *   dataset/classes.json      标签有序表
 *   dataset/data.yaml         ultralytics 训练配置
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import type { BBox, DatasetInfo } from '@shared/types'

export interface AnnotationInput {
  /** 抓帧 dataURL（PNG） */
  dataUrl: string
  cssWidth: number
  cssHeight: number
  boxes: Array<{ label: string; css: BBox }>
}

export class DatasetExporter {
  private root: string
  private imagesDir: string
  private labelsDir: string
  private classesPath: string

  constructor() {
    this.root = join(app.getPath('userData'), 'dataset')
    this.imagesDir = join(this.root, 'images')
    this.labelsDir = join(this.root, 'labels')
    this.classesPath = join(this.root, 'classes.json')
    mkdirSync(this.imagesDir, { recursive: true })
    mkdirSync(this.labelsDir, { recursive: true })
  }

  private readClasses(): string[] {
    if (!existsSync(this.classesPath)) return []
    try {
      return JSON.parse(readFileSync(this.classesPath, 'utf-8')) as string[]
    } catch {
      return []
    }
  }

  private writeClasses(classes: string[]): void {
    writeFileSync(this.classesPath, JSON.stringify(classes, null, 2), 'utf-8')
    const yaml = [
      `path: ${this.root.replace(/\\/g, '/')}`,
      'train: images',
      'val: images',
      `nc: ${classes.length}`,
      `names: [${classes.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')}]`,
      ''
    ].join('\n')
    writeFileSync(join(this.root, 'data.yaml'), yaml, 'utf-8')
  }

  info(): DatasetInfo {
    const classes = this.readClasses()
    const sampleCount = existsSync(this.imagesDir)
      ? readdirSync(this.imagesDir).filter((f) => f.endsWith('.png')).length
      : 0
    return { root: this.root, classes, sampleCount }
  }

  saveSample(input: AnnotationInput): DatasetInfo {
    const base64 = input.dataUrl.slice(input.dataUrl.indexOf(',') + 1)
    const pngBuffer = Buffer.from(base64, 'base64')
    const png = PNG.sync.read(pngBuffer)
    const scale = png.width / input.cssWidth

    const classes = this.readClasses()
    const lines: string[] = []
    for (const box of input.boxes) {
      let idx = classes.indexOf(box.label)
      if (idx < 0) {
        idx = classes.length
        classes.push(box.label)
      }
      // CSS → bitmap → 归一化（YOLO 中心点格式）
      const x1 = (box.css.x1 * scale) / png.width
      const y1 = (box.css.y1 * scale) / png.height
      const x2 = (box.css.x2 * scale) / png.width
      const y2 = (box.css.y2 * scale) / png.height
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2
      const w = Math.abs(x2 - x1)
      const h = Math.abs(y2 - y1)
      const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
      lines.push(
        `${idx} ${clamp01(cx).toFixed(6)} ${clamp01(cy).toFixed(6)} ${clamp01(w).toFixed(6)} ${clamp01(h).toFixed(6)}`
      )
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `sample-${ts}`
    writeFileSync(join(this.imagesDir, `${name}.png`), pngBuffer)
    writeFileSync(join(this.labelsDir, `${name}.txt`), lines.join('\n'), 'utf-8')
    this.writeClasses(classes)
    return this.info()
  }

  getRoot(): string {
    return this.root
  }
}
