/**
 * YOLO26 ONNX 推理引擎（onnxruntime-node，主进程内 CPU 推理）：
 * - 输入：RGBA 位图
 * - 自动识别 e2e / standard 检测头（也可由模型清单强制指定）
 * - 输出：bitmap 物理像素坐标系下的检测结果
 */
import * as ort from 'onnxruntime-node'
import * as os from 'node:os'
import type { ModelManifest } from '@shared/types'
import { letterboxToNCHW, type RawBitmap } from './preprocess'
import {
  decodeAuto,
  decodeE2E,
  decodeStandard,
  clipToInput,
  type RawDetection
} from './postprocess'
import { inverseLetterbox, clampBox } from './coords'

/** 限制 ONNX 线程池规模：默认会占满全部物理核，推理时造成整机 CPU 尖峰 */
const ORT_THREADS = Math.max(1, Math.min(4, os.availableParallelism()))

/** 空闲自动卸载时长：模型会话常驻占用数百 MB 内存，闲置后释放、再次检测时自动重载 */
const IDLE_UNLOAD_MS = 5 * 60 * 1000

/**
 * 推理输入缓冲池（双槽）：连续检测时避免每帧分配 ~6MB Float32Array 造成的 GC 压力。
 * 槽被占用（并发推理）时回退新分配，保证正确性。
 */
class TensorBufferPool {
  private slots: Array<{ buf: Float32Array; busy: boolean }> = []

  acquire(size: number): Float32Array {
    const n = 3 * size * size
    for (const s of this.slots) {
      if (!s.busy && s.buf.length === n) {
        s.busy = true
        return s.buf
      }
    }
    const buf = new Float32Array(n)
    this.slots.push({ buf, busy: true })
    return buf
  }

  release(buf: Float32Array): void {
    for (const s of this.slots) if (s.buf === buf) s.busy = false
  }
}

export interface InferOptions {
  confThreshold?: number
  iouThreshold?: number
}

export interface InferOutput {
  detections: RawDetection[]
  headKind: 'e2e' | 'standard'
  inferenceMs: number
  preprocessMs: number
  postprocessMs: number
  gain: number
  padX: number
  padY: number
  inputName: string
  outputName: string
  providers: string[]
}

export class YoloEngine {
  private session: ort.InferenceSession | null = null
  private manifest: ModelManifest | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private pool = new TensorBufferPool()
  /** 空闲卸载回调（由 IPC 层注入，用于输出日志） */
  onIdleUnload: ((manifest: ModelManifest) => void) | null = null

  async load(manifest: ModelManifest): Promise<{ providers: string[] }> {
    // CPU 优先（onnxruntime-node npm 包默认仅内置 CPU EP），失败时给出清晰错误
    const session = await ort.InferenceSession.create(manifest.onnxPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: ORT_THREADS
    })
    this.session = session
    this.manifest = manifest
    this.armIdleUnload()
    return { providers: session.inputNames ? ['cpu'] : ['cpu'] }
  }

  /** 每次推理后重置空闲计时；闲置超时后释放会话（下次检测自动重载） */
  private armIdleUnload(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      const m = this.manifest
      this.dispose()
      if (m) this.onIdleUnload?.(m)
    }, IDLE_UNLOAD_MS)
    this.idleTimer.unref?.()
  }

  isLoaded(): boolean {
    return this.session !== null
  }

  current(): ModelManifest | null {
    return this.manifest
  }

  async infer(bm: RawBitmap, opts: InferOptions = {}): Promise<InferOutput> {
    if (!this.session || !this.manifest) {
      throw new Error('模型未加载，请先在「模型」面板选择或导入 YOLO26 ONNX 模型')
    }
    const t0 = performance.now()
    const conf = opts.confThreshold ?? this.manifest.confThreshold
    const iou = opts.iouThreshold ?? this.manifest.iouThreshold
    const size = this.manifest.inputSize

    const lb = letterboxToNCHW(bm, size, 114, this.pool.acquire(size))
    const t1 = performance.now()

    const inputName = this.session.inputNames[0]
    const tensor = new ort.Tensor('float32', lb.tensorData, [1, 3, size, size])
    let outputs: Record<string, ort.Tensor>
    try {
      outputs = await this.session.run({ [inputName]: tensor })
    } finally {
      // ORT 在构造 Tensor 时已拷贝数据，推理结束后即可归还缓冲
      this.pool.release(lb.tensorData)
    }
    this.armIdleUnload()
    const t2 = performance.now()

    const outputName = this.session.outputNames[0]
    const outTensor = outputs[outputName]
    const dims = outTensor.dims.map((d) => Number(d))
    const data = outTensor.data as Float32Array

    const decodeOpts = { confThreshold: conf, iouThreshold: iou, inputSize: size }
    let headKind: 'e2e' | 'standard'
    let rawDetections: RawDetection[]
    if (this.manifest.head === 'e2e') {
      headKind = 'e2e'
      rawDetections = decodeE2E(data, dims, decodeOpts)
    } else if (this.manifest.head === 'standard') {
      headKind = 'standard'
      rawDetections = decodeStandard(data, dims, decodeOpts)
    } else {
      const decoded = decodeAuto(data, dims, decodeOpts)
      headKind = decoded.kind
      rawDetections = decoded.detections
    }

    // letterbox 逆变换 → bitmap 坐标，并裁剪到截图范围
    const detections = rawDetections.map((d) => {
      const clipped = clipToInput(d, size)
      const bitmapBox = clampBox(
        inverseLetterbox(clipped.box, lb.gain, lb.padX, lb.padY),
        0,
        0,
        bm.width,
        bm.height
      )
      return { ...d, box: bitmapBox }
    })
    const t3 = performance.now()

    return {
      detections,
      headKind,
      preprocessMs: t1 - t0,
      inferenceMs: t2 - t1,
      postprocessMs: t3 - t2,
      gain: lb.gain,
      padX: lb.padX,
      padY: lb.padY,
      inputName,
      outputName,
      providers: ['cpu']
    }
  }

  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.session = null
    this.manifest = null
  }
}
