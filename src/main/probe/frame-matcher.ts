/**
 * iframe 元素 ↔ WebFrameMain 子 frame 匹配（纯函数，可单测）。
 *
 * 页面脚本只能枚举父文档中的 <iframe> 元素（src/name/rect），
 * 主进程拿到的是 frame 树（url/name）。本模块负责把两边对应起来：
 * 1. 精确 URL 匹配（iframe.src 是 resolve 后的绝对 URL，通常等于 frame.url）
 * 2. name 匹配（iframe name/id ↔ frame.name）
 * 3. about:blank / srcdoc 等空白页按"未占用的空白 frame"顺序匹配
 */
import type { Rect } from '@shared/types'

/** 注入脚本在父文档中采集的 iframe 元素信息 */
export interface IframeElementInfo {
  /** 在父文档 iframe 列表中的下标 */
  domIndex: number
  /** iframe.src IDL 属性（已 resolve 为绝对 URL；未设置 src 时为 ''） */
  src: string
  /** name，缺省回退 id */
  name: string
  /** 内容区域（border 内缘）相对父 frame 视口的 CSS 矩形 */
  rect: Rect
  visible: boolean
}

/** WebFrameMain 的最小结构（便于测试） */
export interface FrameLike {
  url: string
  name: string
}

const BLANK_URLS = new Set(['', 'about:blank', 'about:srcdoc'])

/**
 * 返回 children 中与 iframe 元素对应的下标；无法匹配返回 -1。
 * @param taken 已被其它 iframe 元素占用的 children 下标（同 URL 多实例按顺序分配）
 */
export function matchChildFrameIndex(
  children: FrameLike[],
  el: Pick<IframeElementInfo, 'src' | 'name'>,
  taken: ReadonlySet<number>
): number {
  const isBlank = BLANK_URLS.has(el.src)
  if (!isBlank) {
    for (let i = 0; i < children.length; i++) {
      if (!taken.has(i) && children[i].url === el.src) return i
    }
    // URL 可能因重定向与 src 不一致，继续走 name 兜底
  }
  if (el.name) {
    for (let i = 0; i < children.length; i++) {
      if (!taken.has(i) && children[i].name !== '' && children[i].name === el.name) return i
    }
  }
  if (isBlank) {
    for (let i = 0; i < children.length; i++) {
      if (!taken.has(i) && BLANK_URLS.has(children[i].url)) return i
    }
  }
  return -1
}
