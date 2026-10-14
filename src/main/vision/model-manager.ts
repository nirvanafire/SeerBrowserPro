/**
 * 模型管理器：
 * - 模型存放在 userData/models/<id>/ 下（model.onnx + classes.json）
 * - manifest.json 维护全部模型元信息与当前选中项
 * - 支持：导入本地 ONNX、生成离线假模型（Python）、获取官方 yolo26n（Python）
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ModelManifest } from '@shared/types'
import { fnv1a } from './coords'

interface ModelRegistry {
  models: ModelManifest[]
  activeId: string | null
}

const DEFAULT_CLASSES = [
  'button',
  'close',
  'confirm',
  'cancel',
  'resource',
  'building',
  'character',
  'dialog'
]

export class ModelManager {
  private modelsDir: string
  private registryPath: string
  private registry: ModelRegistry = { models: [], activeId: null }

  constructor() {
    this.modelsDir = join(app.getPath('userData'), 'models')
    this.registryPath = join(this.modelsDir, 'manifest.json')
    mkdirSync(this.modelsDir, { recursive: true })
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.registryPath)) {
        this.registry = JSON.parse(readFileSync(this.registryPath, 'utf-8'))
      }
    } catch (e) {
      console.error('[model-manager] 清单读取失败', e)
      this.registry = { models: [], activeId: null }
    }
  }

  private persist(): void {
    writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8')
  }

  list(): ModelManifest[] {
    return this.registry.models
  }

  activeId(): string | null {
    return this.registry.activeId
  }

  getActive(): ModelManifest | null {
    return this.registry.models.find((m) => m.id === this.registry.activeId) ?? null
  }

  getById(id: string): ModelManifest | null {
    return this.registry.models.find((m) => m.id === id) ?? null
  }

  select(id: string): void {
    if (!this.registry.models.some((m) => m.id === id)) {
      throw new Error('模型不存在')
    }
    this.registry.activeId = id
    this.persist()
  }

  /**
   * 导入 ONNX 模型。
   * @param onnxSrc 源 .onnx 路径
   * @param classes 类别名数组（可选，缺省用占位 class_0..n）
   * @param head 检测头类型，默认 auto
   */
  importModel(opts: {
    onnxPath: string
    name?: string
    classes?: string[]
    classesPath?: string
    head?: ModelManifest['head']
    inputSize?: number
  }): ModelManifest {
    if (!existsSync(opts.onnxPath)) throw new Error(`ONNX 文件不存在: ${opts.onnxPath}`)
    const id = randomUUID().slice(0, 8)
    const dir = join(this.modelsDir, id)
    mkdirSync(dir, { recursive: true })
    const dst = join(dir, 'model.onnx')
    copyFileSync(opts.onnxPath, dst)

    let classes = opts.classes
    let classesPath = opts.classesPath
    if (!classes && classesPath && existsSync(classesPath)) {
      classes = JSON.parse(readFileSync(classesPath, 'utf-8'))
    }
    if (!classes || classes.length === 0) classes = DEFAULT_CLASSES
    const classesDst = join(dir, 'classes.json')
    writeFileSync(classesDst, JSON.stringify(classes, null, 2), 'utf-8')

    const manifest: ModelManifest = {
      id,
      name: opts.name ?? onnxBaseName(opts.onnxPath),
      onnxPath: dst,
      classesPath: classesDst,
      classes,
      inputSize: opts.inputSize ?? 640,
      head: opts.head ?? 'auto',
      confThreshold: 0.35,
      iouThreshold: 0.6,
      builtin: false,
      createdAt: Date.now()
    }
    this.registry.models.push(manifest)
    if (!this.registry.activeId) this.registry.activeId = id
    this.persist()
    return manifest
  }

  /**
   * 注册已在模型目录内的 ONNX（供 Python 脚本直接生成模型时使用，不复制）。
   */
  registerExisting(opts: {
    onnxPath: string
    name: string
    classes: string[]
    head?: ModelManifest['head']
    inputSize?: number
    builtin?: boolean
  }): ModelManifest {
    if (!existsSync(opts.onnxPath)) throw new Error(`ONNX 文件不存在: ${opts.onnxPath}`)
    const id = fnv1a(opts.onnxPath + opts.name).slice(0, 8)
    const existed = this.registry.models.find((m) => m.id === id)
    if (existed) return existed
    const classesPath = join(dirnameOf(opts.onnxPath), 'classes.json')
    writeFileSync(classesPath, JSON.stringify(opts.classes, null, 2), 'utf-8')
    const manifest: ModelManifest = {
      id,
      name: opts.name,
      onnxPath: opts.onnxPath,
      classesPath,
      classes: opts.classes,
      inputSize: opts.inputSize ?? 640,
      head: opts.head ?? 'auto',
      confThreshold: 0.35,
      iouThreshold: 0.6,
      builtin: opts.builtin ?? false,
      createdAt: Date.now()
    }
    this.registry.models.push(manifest)
    if (!this.registry.activeId) this.registry.activeId = id
    this.persist()
    return manifest
  }

  update(id: string, patch: Partial<Pick<ModelManifest, 'confThreshold' | 'iouThreshold' | 'name' | 'head' | 'inputSize'>>): void {
    const m = this.registry.models.find((x) => x.id === id)
    if (!m) throw new Error('模型不存在')
    Object.assign(m, patch)
    this.persist()
  }

  remove(id: string): void {
    const m = this.registry.models.find((x) => x.id === id)
    if (!m) return
    const dir = join(this.modelsDir, id)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    this.registry.models = this.registry.models.filter((x) => x.id !== id)
    if (this.registry.activeId === id) {
      this.registry.activeId = this.registry.models[0]?.id ?? null
    }
    this.persist()
  }

  getModelsDir(): string {
    return this.modelsDir
  }
}

function onnxBaseName(p: string): string {
  const file = p.split(/[\\/]/).pop() ?? 'model.onnx'
  return file.replace(/\.onnx$/i, '')
}

function dirnameOf(p: string): string {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join('\\')
}
