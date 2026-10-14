/**
 * 功能模块缓存：每个游戏页面一个 JSON 文件（userData/cache/<pageId>.json）。
 * 缓存内容 = 页面签名 + 功能模块（标签、动作、归一化坐标、模板缩略图、命中次数）。
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CachedPage, GameModule, PageSignature } from '@shared/types'
import { hammingDistanceHex, pageIdOf, type PageIdentity } from './page-signature'

const VISUAL_MATCH_DISTANCE = 10

export class ModuleStore {
  private cacheDir: string

  constructor() {
    this.cacheDir = join(app.getPath('userData'), 'cache')
    mkdirSync(this.cacheDir, { recursive: true })
  }

  private pathFor(id: string): string {
    return join(this.cacheDir, `${id}.json`)
  }

  loadPage(id: string): CachedPage | null {
    const p = this.pathFor(id)
    if (!existsSync(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as CachedPage
    } catch {
      return null
    }
  }

  savePage(page: CachedPage): void {
    page.updatedAt = Date.now()
    writeFileSync(this.pathFor(page.id), JSON.stringify(page, null, 2), 'utf-8')
  }

  getOrCreatePage(signature: PageSignature): CachedPage {
    const id = pageIdOf(signature)
    const existing = this.loadPage(id)
    if (existing) return existing
    const page: CachedPage = {
      id,
      signature,
      modules: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.savePage(page)
    return page
  }

  listPages(): CachedPage[] {
    if (!existsSync(this.cacheDir)) return []
    return readdirSync(this.cacheDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(this.cacheDir, f), 'utf-8')) as CachedPage
        } catch {
          return null
        }
      })
      .filter((p): p is CachedPage => p !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  deletePage(id: string): void {
    const p = this.pathFor(id)
    if (existsSync(p)) rmSync(p, { force: true })
  }

  upsertModule(pageId: string, module: GameModule): CachedPage | null {
    const page = this.loadPage(pageId)
    if (!page) return null
    const idx = page.modules.findIndex((m) => m.id === module.id)
    if (idx >= 0) page.modules[idx] = module
    else page.modules.push(module)
    this.savePage(page)
    return page
  }

  deleteModule(pageId: string, moduleId: string): CachedPage | null {
    const page = this.loadPage(pageId)
    if (!page) return null
    page.modules = page.modules.filter((m) => m.id !== moduleId)
    this.savePage(page)
    return page
  }

  /**
   * 匹配当前页面：先精确（pageId），再模糊（同 origin + DOM/视觉哈希近似）。
   */
  matchPage(
    identity: PageIdentity,
    visualHash?: string
  ): { page: CachedPage; reason: 'exact' | 'dom' | 'visual' } | null {
    const exactId = pageIdOf(identity)
    const exact = this.loadPage(exactId)
    if (exact) return { page: exact, reason: 'exact' }

    let best: { page: CachedPage; distance: number } | null = null
    for (const page of this.listPages()) {
      if (page.signature.origin !== identity.origin) continue
      if (page.signature.domHash === identity.domHash) {
        return { page, reason: 'dom' }
      }
      if (visualHash) {
        const d = hammingDistanceHex(page.signature.visualHash, visualHash)
        if (d <= VISUAL_MATCH_DISTANCE && (!best || d < best.distance)) {
          best = { page, distance: d }
        }
      }
    }
    if (best) return { page: best.page, reason: 'visual' }
    return null
  }

  static newModule(partial: Partial<GameModule> & Pick<GameModule, 'label' | 'classId'>): GameModule {
    return {
      id: randomUUID().slice(0, 8),
      label: partial.label,
      classId: partial.classId,
      action: partial.action ?? 'click',
      bboxCanvasNorm: partial.bboxCanvasNorm ?? null,
      bboxViewportNorm: partial.bboxViewportNorm ?? { x1: 0, y1: 0, x2: 0, y2: 0 },
      template: partial.template ?? [],
      confidence: partial.confidence ?? 0,
      locked: partial.locked ?? false,
      hitCount: partial.hitCount ?? 0,
      lastSeen: Date.now(),
      note: partial.note
    }
  }
}
