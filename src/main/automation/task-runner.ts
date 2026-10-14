/**
 * 自动化任务执行器：
 *   截图 -> YOLO 推理 -> 页面签名匹配 -> 检测结果与缓存模块融合
 *   -> 决策（loop 按标签点击 / sequence 步骤序列）-> 拟人输入
 *
 * 安全保险：dryRun 空跑、maxLoops 动作上限、最小 tick 间隔、Escape 急停、异常自动停止。
 */
import type {
  AutomationConfig,
  BBox,
  CachedPage,
  Detection,
  GameModule,
  PageSignature,
  Rect,
  TaskState
} from '@shared/types'
import type { TabManager } from '../browser/tab-manager'
import type { DetectService, SenseOutput } from './detect-service'
import type { ModuleStore } from '../cache/module-store'
import { collectPageIdentity, dHash, type PageIdentity } from '../cache/page-signature'
import { matchDetectionsToModules, type MatchPair } from './matcher'
import { performAction } from './human-input'
import { renderOverlay, type OverlayItem } from './overlay-injector'
import { resolveModuleBox, center } from '../vision/coords'
import { cropBitmap, grayThumbnail } from '../vision/preprocess'
import { verifyAgainstTemplate } from './template-verifier'

interface SensedPage extends SenseOutput {
  identity: PageIdentity
  visualHash: string
  page: CachedPage
  pairs: MatchPair[]
  matchReason: string
}

export class TaskRunner {
  private running = false
  private cancelRequested = false
  private state: TaskState = {
    running: false,
    loopCount: 0,
    tickCount: 0,
    lastAction: '',
    startedAt: null
  }
  onLog: ((level: 'info' | 'warn' | 'error' | 'action', msg: string) => void) | null = null
  onState: ((s: TaskState) => void) | null = null
  onCacheChanged: (() => void) | null = null
  onFrame: ((sense: SenseOutput) => void) | null = null

  constructor(
    private tabs: TabManager,
    private detect: DetectService,
    private store: ModuleStore
  ) {}

  isRunning(): boolean {
    return this.running
  }

  getState(): TaskState {
    return { ...this.state }
  }

  stop(reason = '用户停止'): void {
    if (!this.running) return
    this.cancelRequested = true
    this.log('warn', `任务停止：${reason}`)
  }

  async start(cfg: AutomationConfig): Promise<void> {
    if (this.running) throw new Error('已有任务在运行')
    this.running = true
    this.cancelRequested = false
    this.state = {
      running: true,
      loopCount: 0,
      tickCount: 0,
      lastAction: '启动',
      startedAt: Date.now()
    }
    this.emitState()
    this.log('info', `任务启动（${cfg.mode}${cfg.dryRun ? '，dryRun 空跑' : ''}）`)
    try {
      if (cfg.mode === 'loop') await this.runLoop(cfg)
      else await this.runSequence(cfg)
    } catch (e) {
      this.log('error', `任务异常终止：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.running = false
      this.state.running = false
      this.state.lastAction = '已结束'
      this.emitState()
    }
  }

  // ---------- 感知 + 缓存融合 ----------

  private async sensePage(): Promise<SensedPage> {
    const sense = await this.detect.sense(true)
    const tab = this.tabs.getActive()!
    const wc = tab.view.webContents
    const identity = await collectPageIdentity(wc)
    const visualHash = dHash(sense.bitmap)
    const matched = this.store.matchPage(identity, visualHash)
    const signature: PageSignature = { ...identity, visualHash }
    const page = matched?.page ?? this.store.getOrCreatePage(signature)
    page.signature.visualHash = visualHash
    if (!matched) this.log('info', `新页面入库：${identity.origin}${identity.pathPattern}`)

    const makeTemplate = (d: Detection): number[] => {
      try {
        const crop = cropBitmap(
          sense.bitmap,
          d.bitmap.x1,
          d.bitmap.y1,
          d.bitmap.x2 - d.bitmap.x1,
          d.bitmap.y2 - d.bitmap.y1
        )
        return grayThumbnail(crop, 32, 32)
      } catch {
        return []
      }
    }

    const merged = matchDetectionsToModules(sense.detections, page.modules, true, makeTemplate)
    // 已更新模块 + 本轮未命中的旧模块（锁定与否都保留，陈旧模块仅不参与优先点击）
    const byId = new Map<string, GameModule>()
    for (const p of merged.pairs) byId.set(p.module.id, p.module)
    for (const m of merged.missing) if (!byId.has(m.id)) byId.set(m.id, m)
    page.modules = [...byId.values()]
    this.store.savePage(page)
    this.onCacheChanged?.()

    // 覆盖层：检测绿框 + 未命中的缓存模块蓝框
    const items: OverlayItem[] = [
      ...sense.detections.map((d) => ({
        ...d.css,
        label: d.label,
        confidence: d.confidence,
        kind: 'detect' as const
      })),
      ...merged.missing.map((m) => {
        const box = resolveModuleBox(m, sense.canvasRect, sense.cap.cssWidth, sense.cap.cssHeight)
        return { ...box, label: `[缓存] ${m.label}`, kind: 'module' as const }
      })
    ]
    await renderOverlay(wc, items)
    this.onFrame?.(sense)

    return {
      ...sense,
      identity,
      visualHash,
      page,
      pairs: merged.pairs,
      matchReason: matched?.reason ?? 'created'
    }
  }

  // ---------- loop 模式 ----------

  private async runLoop(cfg: AutomationConfig): Promise<void> {
    while (!this.cancelRequested) {
      if (cfg.maxLoops > 0 && this.state.loopCount >= cfg.maxLoops) {
        this.log('info', `达到动作上限 ${cfg.maxLoops}，任务结束`)
        break
      }
      const page = await this.sensePage()
      this.state.tickCount++
      this.emitState()

      if (cfg.stopLabel && page.detections.some((d) => d.label === cfg.stopLabel)) {
        this.log('info', `检测到停止信号「${cfg.stopLabel}」，任务结束`)
        break
      }

      const target = this.pickTarget(page.pairs, cfg.clickLabels, cfg.confidence)
      if (target) {
        const ok = await this.actOnPair(target, page, cfg)
        if (ok) {
          this.state.loopCount++
          this.emitState()
        }
      } else {
        this.log('info', `本轮未发现目标：${cfg.clickLabels.join(' / ') || '（未配置标签）'}`)
      }
      await this.sleepCancel(cfg.tickIntervalMs)
    }
  }

  // ---------- sequence 模式 ----------

  private async runSequence(cfg: AutomationConfig): Promise<void> {
    if (cfg.steps.length === 0) throw new Error('序列模式未配置任何步骤')
    const rounds = cfg.loop ? Math.max(1, cfg.maxLoops) : 1
    for (let round = 1; round <= rounds && !this.cancelRequested; round++) {
      this.log('info', `—— 序列第 ${round}/${rounds} 轮 ——`)
      for (const step of cfg.steps) {
        if (this.cancelRequested) break
        switch (step.type) {
          case 'wait':
            await this.sleepCancel(step.ms)
            break
          case 'clickPoint': {
            const page = await this.sensePage()
            const box = this.pointToBox(step.xNorm, step.yNorm, page.canvasRect, page.cap.cssWidth, page.cap.cssHeight)
            await this.actOnBox(box, `point(${step.xNorm.toFixed(2)},${step.yNorm.toFixed(2)})`, 'click', cfg, page)
            await this.sleepCancel(step.waitAfter ?? 400)
            break
          }
          case 'click': {
            const found = await this.waitForLabel(step.target, 5000, cfg.tickIntervalMs)
            if (!found) throw new Error(`click 步骤超时：未找到「${step.target}」`)
            const pair = this.pickTarget(found.pairs, [step.target], cfg.confidence)
            if (!pair) throw new Error(`click 步骤无法定位「${step.target}」`)
            await this.actOnPair(pair, found, cfg)
            await this.sleepCancel(step.waitAfter ?? 500)
            break
          }
          case 'waitFor':
          case 'verify': {
            const found = await this.waitForLabel(step.target, step.timeout ?? 8000, cfg.tickIntervalMs)
            if (!found) {
              if (step.type === 'verify') throw new Error(`verify 失败：未出现「${step.target}」`)
              this.log('warn', `等待「${step.target}」超时，继续执行`)
            } else {
              this.log('info', `已出现「${step.target}」`)
            }
            break
          }
        }
      }
    }
  }

  private async waitForLabel(
    label: string,
    timeoutMs: number,
    intervalMs: number
  ): Promise<SensedPage | null> {
    const deadline = Date.now() + timeoutMs
    let last: SensedPage | null = null
    while (Date.now() < deadline && !this.cancelRequested) {
      last = await this.sensePage()
      if (last.pairs.some((p) => p.module.label === label)) return last
      await this.sleepCancel(intervalMs)
    }
    return last && last.pairs.some((p) => p.module.label === label) ? last : null
  }

  // ---------- 决策与动作 ----------

  private pickTarget(pairs: MatchPair[], labels: string[], minConf: number): MatchPair | null {
    for (const label of labels) {
      const candidates = pairs
        .filter((p) => p.module.label === label)
        .sort((a, b) => (b.detection?.confidence ?? b.module.confidence) - (a.detection?.confidence ?? a.module.confidence))
      const best = candidates[0]
      if (!best) continue
      const conf = best.detection?.confidence ?? best.module.confidence
      if (conf >= minConf) return best
    }
    return null
  }

  private pointToBox(xNorm: number, yNorm: number, canvasRect: Rect | null, cssW: number, cssH: number): BBox {
    if (canvasRect) {
      return {
        x1: canvasRect.x + xNorm * canvasRect.width,
        y1: canvasRect.y + yNorm * canvasRect.height,
        x2: canvasRect.x + xNorm * canvasRect.width + 4,
        y2: canvasRect.y + yNorm * canvasRect.height + 4
      }
    }
    return { x1: xNorm * cssW, y1: yNorm * cssH, x2: xNorm * cssW + 4, y2: yNorm * cssH + 4 }
  }

  private resolvePairBox(pair: MatchPair, page: SensedPage): BBox {
    if (pair.detection) return pair.detection.css
    const box = resolveModuleBox(
      pair.module,
      page.canvasRect,
      page.cap.cssWidth,
      page.cap.cssHeight
    )
    // 缓存坐标：有模板时用 NCC 校验 UI 是否仍在该位置
    if (pair.module.template.length > 0) {
      const scale = page.cap.scale
      const crop = cropBitmap(
        page.bitmap,
        box.x1 * scale,
        box.y1 * scale,
        (box.x2 - box.x1) * scale,
        (box.y2 - box.y1) * scale
      )
      const sim = verifyAgainstTemplate(crop, pair.module.template)
      if (sim < 0.55) {
        throw new Error(`模板校验未通过（NCC=${sim.toFixed(2)}），跳过「${pair.module.label}」避免误点`)
      }
    }
    return box
  }

  private async actOnPair(pair: MatchPair, page: SensedPage, cfg: AutomationConfig): Promise<boolean> {
    try {
      const box = this.resolvePairBox(pair, page)
      return await this.actOnBox(box, pair.module.label, pair.module.action, cfg, page)
    } catch (e) {
      this.log('warn', e instanceof Error ? e.message : String(e))
      return false
    }
  }

  private async actOnBox(
    box: BBox,
    label: string,
    action: string,
    cfg: AutomationConfig,
    page: SensedPage
  ): Promise<boolean> {
    const c = center(box)
    const tab = this.tabs.getActive()
    if (!tab) return false
    const msg = `${action}「${label}」@(${Math.round(c.x)},${Math.round(c.y)})${cfg.dryRun ? ' [dryRun]' : ''}`
    this.state.lastAction = msg
    this.log('action', msg)
    // 红色目标框短暂提示
    await renderOverlay(tab.view.webContents, [{ ...box, label: 'TARGET ' + label, kind: 'target' }])
    if (!cfg.dryRun) {
      await performAction(
        tab.view.webContents,
        action as never,
        c.x,
        c.y,
        page.cap.cssWidth,
        page.cap.cssHeight
      )
    }
    await this.sleepCancel(180)
    return true
  }

  // ---------- 工具 ----------

  private async sleepCancel(ms: number): Promise<void> {
    const minInterval = 250
    const total = Math.max(minInterval, ms)
    const step = 100
    let waited = 0
    while (waited < total) {
      if (this.cancelRequested) throw new Error('任务已被急停')
      await new Promise((r) => setTimeout(r, Math.min(step, total - waited)))
      waited += step
    }
  }

  private log(level: 'info' | 'warn' | 'error' | 'action', msg: string): void {
    this.onLog?.(level, msg)
  }

  private emitState(): void {
    this.onState?.(this.getState())
  }
}
