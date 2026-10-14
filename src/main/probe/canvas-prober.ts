/**
 * Canvas 探针：遍历 WebContents 的整棵 frame 树（含跨源 iframe），
 * 在每个 frame 主世界执行只读脚本枚举 <canvas>，并把坐标统一换算到顶层视口。
 *
 * - 每个 frame 的脚本枚举本 document 的 canvas + iframe 元素（src/name/rect）
 * - 主进程用 frame-matcher 把 iframe 元素与子 WebFrameMain 对应，递归下钻
 * - iframe 内 Canvas 的 rect = 本 frame 视口坐标 + 祖先 iframe 内容原点累计偏移
 *
 * 上下文类型优先读取 CDP 注入钩子（Page.addScriptToEvaluateOnNewDocument，对所有
 * frame 生效）记录的 data-seer-ctx；无记录时才回退调用 getContext 探测。
 */
import type { WebContents, WebFrameMain } from 'electron'
import type { CanvasInfo, CanvasSelection, Rect } from '@shared/types'
import { matchChildFrameIndex, type IframeElementInfo } from './frame-matcher'

const MAX_DEPTH = 6
const TOP_PATH = 'top'

/** 注入脚本原始返回（canvas 的 rect 相对本 frame 视口） */
interface FrameProbePayload {
  canvases: Array<{
    selector: string
    id: string
    className: string
    contextType: string
    width: number
    height: number
    rect: Rect
    visible: boolean
  }>
  iframes: IframeElementInfo[]
}

/**
 * 注意：以下函数体会被序列化后注入各 frame 执行，
 * 不能引用 Node/Electron 作用域中的任何变量。
 */

/** 枚举本 document 的 canvas（可选仅查询指定选择器）与 iframe 元素 */
function pageProbe(onlySelector?: string): unknown {
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

  const isVisible = (el: Element, rect: DOMRect): boolean => {
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

  let canvasEls: HTMLCanvasElement[]
  if (onlySelector) {
    const el = document.querySelector(onlySelector)
    canvasEls = el && el.tagName === 'CANVAS' ? [el as HTMLCanvasElement] : []
  } else {
    canvasEls = Array.from(document.querySelectorAll('canvas'))
  }

  const canvases = canvasEls.map((c) => {
    const r = c.getBoundingClientRect()
    return {
      selector: buildSelector(c),
      id: c.id,
      className: typeof c.className === 'string' ? c.className : '',
      contextType: detectContext(c),
      width: c.width,
      height: c.height,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      visible: isVisible(c, r)
    }
  })

  const iframes = Array.from(document.querySelectorAll('iframe')).map((el, domIndex) => {
    const r = el.getBoundingClientRect()
    // 内容坐标原点 = border 内缘（clientLeft/clientTop 即渲染后的 border 宽度）
    return {
      domIndex,
      src: el.src || '',
      name: el.name || el.id || '',
      rect: { x: r.x + el.clientLeft, y: r.y + el.clientTop, width: el.clientWidth, height: el.clientHeight },
      visible: isVisible(el, r)
    }
  })

  return { canvases, iframes }
}

/** 查询本 document 中指定选择器（或下标）canvas 的视口矩形 */
function rectProbe(selector: string | null, index: number): unknown {
  let el: Element | null = null
  if (selector) {
    el = document.querySelector(selector)
    if (el && el.tagName !== 'CANVAS') el = null
  } else {
    el = document.querySelectorAll('canvas')[index] ?? null
  }
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** 仅枚举本 document 的 iframe 元素（下钻定位用，比 pageProbe 轻量） */
function iframeListProbe(): unknown {
  return Array.from(document.querySelectorAll('iframe')).map((el, domIndex) => {
    const r = el.getBoundingClientRect()
    return {
      domIndex,
      src: el.src || '',
      name: el.name || el.id || '',
      rect: { x: r.x + el.clientLeft, y: r.y + el.clientTop, width: el.clientWidth, height: el.clientHeight },
      visible: r.width > 1 && r.height > 1
    }
  })
}

interface FrameTarget {
  frame: WebFrameMain
  ox: number
  oy: number
}

/**
 * 按探测时记录的 framePath（如 'top › iframe[2] › iframe[0]'）逐层下钻定位 frame，
 * 同时累计各层 iframe 内容原点偏移。结构变化导致匹配失败时返回 null。
 */
async function drillToFrame(
  frame: WebFrameMain,
  targetPath: string,
  path: string,
  ox: number,
  oy: number,
  depth: number
): Promise<FrameTarget | null> {
  if (path === targetPath) return { frame, ox, oy }
  if (depth > MAX_DEPTH) return null
  let iframes: IframeElementInfo[]
  try {
    iframes = (await frame.executeJavaScript(`(${iframeListProbe.toString()})()`)) as IframeElementInfo[]
  } catch {
    return null
  }
  if (!Array.isArray(iframes)) return null
  const children = frame.frames
  const taken = new Set<number>()
  for (const el of iframes) {
    const ci = matchChildFrameIndex(children, el, taken)
    if (ci < 0) continue
    taken.add(ci)
    const childPath = `${path} › iframe[${el.domIndex}]`
    // targetPath 只可能出现在匹配路径的子树里，前缀不符可剪枝
    if (!targetPath.startsWith(childPath)) continue
    const hit = await drillToFrame(
      children[ci],
      targetPath,
      childPath,
      ox + el.rect.x,
      oy + el.rect.y,
      depth + 1
    )
    if (hit) return hit
  }
  return null
}

async function execProbe(frame: WebFrameMain, onlySelector?: string): Promise<FrameProbePayload | null> {
  const arg = onlySelector ? JSON.stringify(onlySelector) : 'undefined'
  try {
    const payload = (await frame.executeJavaScript(`(${pageProbe.toString()})(${arg})`)) as FrameProbePayload
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/** 遍历整棵 frame 树，枚举全部 Canvas（rect 已换算为顶层视口 CSS 坐标） */
export async function probeCanvases(wc: WebContents): Promise<CanvasInfo[]> {
  const out: CanvasInfo[] = []

  const walk = async (
    frame: WebFrameMain,
    ox: number,
    oy: number,
    path: string,
    depth: number,
    ancestorVisible: boolean
  ): Promise<void> => {
    if (depth > MAX_DEPTH) return
    const payload = await execProbe(frame)
    if (!payload) return
    for (const c of payload.canvases ?? []) {
      out.push({
        index: -1,
        selector: c.selector,
        framePath: path,
        frameUrl: frame.url,
        id: c.id,
        className: c.className,
        contextType: c.contextType,
        width: c.width,
        height: c.height,
        rect: { x: c.rect.x + ox, y: c.rect.y + oy, width: c.rect.width, height: c.rect.height },
        visible: c.visible && ancestorVisible,
        activity: 0,
        score: 0
      })
    }
    const children = frame.frames
    const taken = new Set<number>()
    for (const el of payload.iframes ?? []) {
      const ci = matchChildFrameIndex(children, el, taken)
      if (ci < 0) continue
      taken.add(ci)
      await walk(
        children[ci],
        ox + el.rect.x,
        oy + el.rect.y,
        `${path} › iframe[${el.domIndex}]`,
        depth + 1,
        ancestorVisible && el.visible
      )
    }
  }

  await walk(wc.mainFrame, 0, 0, TOP_PATH, 0, true)
  // 统一全局编号（防御页面篡改）
  return out.map((c, i) => ({ ...c, index: i }))
}

/** 通过 CSS 选择器查询单个 canvas（跨 frame 搜索，手动配置路径） */
export async function probeBySelector(
  wc: WebContents,
  selector: string
): Promise<CanvasInfo | null> {
  let found: CanvasInfo | null = null

  const walk = async (
    frame: WebFrameMain,
    ox: number,
    oy: number,
    path: string,
    depth: number
  ): Promise<boolean> => {
    if (depth > MAX_DEPTH) return false
    const payload = await execProbe(frame, selector)
    if (!payload) return false
    const c = payload.canvases?.[0]
    if (c) {
      found = {
        index: -1,
        selector,
        framePath: path,
        frameUrl: frame.url,
        id: c.id,
        className: c.className,
        contextType: c.contextType,
        width: c.width,
        height: c.height,
        rect: { x: c.rect.x + ox, y: c.rect.y + oy, width: c.rect.width, height: c.rect.height },
        visible: c.visible,
        activity: 0,
        score: 0
      }
      return true
    }
    const children = frame.frames
    const taken = new Set<number>()
    for (const el of payload.iframes ?? []) {
      const ci = matchChildFrameIndex(children, el, taken)
      if (ci < 0) continue
      taken.add(ci)
      if (await walk(children[ci], ox + el.rect.x, oy + el.rect.y, `${path} › iframe[${el.domIndex}]`, depth + 1)) {
        return true
      }
    }
    return false
  }

  await walk(wc.mainFrame, 0, 0, TOP_PATH, 0)
  return found
}

async function rectInFrame(
  frame: WebFrameMain,
  selector: string | null,
  index: number,
  ox: number,
  oy: number
): Promise<Rect | null> {
  const selArg = selector ? JSON.stringify(selector) : 'null'
  try {
    const r = (await frame.executeJavaScript(
      `(${rectProbe.toString()})(${selArg}, ${index})`
    )) as Rect | null
    if (!r) return null
    return { x: r.x + ox, y: r.y + oy, width: r.width, height: r.height }
  } catch {
    return null
  }
}

/**
 * 解析当前所选 Canvas 在顶层视口中的最新 CSS 矩形（兼容窗口缩放与 iframe 布局变化）。
 * - index 选择：依据探测缓存中的 framePath/选择器定位到对应 frame
 * - selector 选择：顶层命中直接用；否则整树搜索
 * - 缓存缺失时回退顶层旧行为（querySelectorAll('canvas')[index]）
 */
export async function resolveSelectionRect(
  wc: WebContents,
  selection: CanvasSelection,
  cached: CanvasInfo[]
): Promise<Rect | null> {
  if (selection.kind === 'index') {
    const info = cached.find((c) => c.index === selection.index)
    if (info) {
      if (info.framePath === TOP_PATH) return rectInFrame(wc.mainFrame, info.selector, -1, 0, 0)
      const hit = await drillToFrame(wc.mainFrame, info.framePath, TOP_PATH, 0, 0, 0)
      if (hit) return rectInFrame(hit.frame, info.selector, -1, hit.ox, hit.oy)
      return null
    }
    return rectInFrame(wc.mainFrame, null, selection.index, 0, 0)
  }

  const top = await rectInFrame(wc.mainFrame, selection.selector, -1, 0, 0)
  if (top) return top
  // 跨 frame 搜索：按 probeBySelector 同样的路径定位后取 rect
  const found = await probeBySelector(wc, selection.selector)
  if (!found) return null
  if (found.framePath === TOP_PATH) return rectInFrame(wc.mainFrame, selection.selector, -1, 0, 0)
  const hit = await drillToFrame(wc.mainFrame, found.framePath, TOP_PATH, 0, 0, 0)
  if (!hit) return null
  return rectInFrame(hit.frame, selection.selector, -1, hit.ox, hit.oy)
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
