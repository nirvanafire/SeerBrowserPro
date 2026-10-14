/**
 * Canvas 探针：通过 executeJavaScript 在页面主世界执行只读脚本，
 * 枚举全部 <canvas> 的上下文类型、backing store 尺寸、视口矩形、可见性与 CSS 选择器。
 *
 * 上下文类型优先读取 CDP 注入钩子（Page.addScriptToEvaluateOnNewDocument）
 * 记录的 data-seer-ctx（对页面零副作用）；无记录时（调试器附加失败等）
 * 才在页面加载完成后回退调用 getContext 探测。
 */
import type { WebContents } from 'electron'
import type { CanvasInfo, Rect } from '@shared/types'

/**
 * 注意：该函数体会被序列化后注入页面执行，不能引用 Node/Electron 作用域中的任何变量。
 */
function pageProbe(): unknown {
  const buildSelector = (el: Element): string => {
    if (el.id) return '#' + CSS.escape(el.id)
    const parts: string[] = []
    let cur: Element | null = el
    let depth = 0
    while (cur && cur.nodeType === 1 && depth < 4) {
      const tag = cur.tagName.toLowerCase()
      if (cur.id) {
        parts.unshift('#' + CSS.escape(cur.id) + (parts.length ? ' > ' + parts.join(' > ') : ''))
        break
      }
      const parent: Element | null = cur.parentElement
      let nth = 1
      if (parent) {
        const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === cur!.tagName)
        nth = siblings.indexOf(cur) + 1
      }
      parts.unshift(`${tag}:nth-of-type(${nth})`)
      cur = parent
      depth++
    }
    return parts.join(' > ')
  }

  const isVisible = (el: HTMLCanvasElement, rect: DOMRect): boolean => {
    const st = getComputedStyle(el)
    return (
      rect.width > 1 &&
      rect.height > 1 &&
      st.display !== 'none' &&
      st.visibility !== 'hidden' &&
      parseFloat(st.opacity) > 0.01
    )
  }

  const detectContext = (c: HTMLCanvasElement): string => {
    const recorded = c.getAttribute('data-seer-ctx')
    if (recorded) return recorded
    // 回退路径：仅在游戏已初始化 Canvas 后（加载完成）执行，失败不影响页面
    try {
      if (c.getContext('2d')) return '2d'
    } catch {
      /* ignore */
    }
    try {
      if (c.getContext('webgl2')) return 'webgl2'
    } catch {
      /* ignore */
    }
    try {
      if (c.getContext('webgl') || c.getContext('experimental-webgl')) return 'webgl'
    } catch {
      /* ignore */
    }
    try {
      if (c.getContext('webgpu')) return 'webgpu'
    } catch {
      /* ignore */
    }
    return 'unknown'
  }

  return Array.from(document.querySelectorAll('canvas')).map((c, index) => {
    const r = c.getBoundingClientRect()
    const rect: Rect = { x: r.x, y: r.y, width: r.width, height: r.height }
    return {
      index,
      selector: buildSelector(c),
      id: c.id,
      className: typeof c.className === 'string' ? c.className : '',
      contextType: detectContext(c),
      width: c.width,
      height: c.height,
      rect,
      visible: isVisible(c, r),
      activity: 0,
      score: 0
    }
  })
}

export async function probeCanvases(wc: WebContents): Promise<CanvasInfo[]> {
  const raw = (await wc.executeJavaScript(`(${pageProbe.toString()})()`)) as CanvasInfo[]
  if (!Array.isArray(raw)) return []
  // 重新编号（防御页面篡改）
  return raw.map((c, i) => ({ ...c, index: c.index ?? i, activity: 0, score: 0 }))
}

/** 通过 CSS 选择器查询单个 canvas 的信息（手动配置路径） */
export async function probeBySelector(
  wc: WebContents,
  selector: string
): Promise<CanvasInfo | null> {
  const list = await probeCanvases(wc)
  const matched = list.find((c) => c.selector === selector)
  if (matched) return matched
  // 选择器可能由用户手写：验证它确实指向一个 canvas
  const exists = await wc.executeJavaScript(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!(el && el.tagName === 'CANVAS'); })()`
  )
  if (!exists) return null
  const full = await wc.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      return { index: -1, selector: ${JSON.stringify(selector)}, id: el.id, className: el.className || '',
        contextType: el.getAttribute('data-seer-ctx') || 'unknown', width: el.width, height: el.height,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height }, visible: r.width > 1 && r.height > 1,
        activity: 0, score: 0 };
    })()`
  )
  return full as CanvasInfo
}

/**
 * 综合评分：可见性 + 上下文权重 + 面积占比 + 活动度。
 * activity 由 activity-detector 填充（0~1）。
 */
export function scoreCanvas(c: CanvasInfo, viewportCssW: number, viewportCssH: number): number {
  if (!c.visible) return 0
  const ctxWeight =
    c.contextType === 'webgl2' || c.contextType === 'webgl'
      ? 0.3
      : c.contextType === 'webgpu'
        ? 0.28
        : c.contextType === '2d'
          ? 0.18
          : 0.05
  const area = c.rect.width * c.rect.height
  const viewportArea = Math.max(1, viewportCssW * viewportCssH)
  const areaScore = Math.min(0.35, (area / viewportArea) * 0.5)
  const activityScore = Math.min(0.35, c.activity)
  return Math.round((ctxWeight + areaScore + activityScore) * 1000) / 1000
}
