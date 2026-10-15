/**
 * 主窗布局常量（React 控制面板与内嵌网页视图的边界契约）。
 * React UI 占据 L 形区域：顶部通栏 + 左侧边栏；网页视图占据右下矩形。
 * 修改这些值时必须同步 src/renderer 的样式变量。
 */
export const TOP_BAR_HEIGHT = 84
/** 隐藏标签栏后的顶栏高度（仅保留地址栏行，与渲染层 CSS 同步） */
export const TOP_BAR_HEIGHT_NO_TABS = 46
export const SIDEBAR_WIDTH = 360

export interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
}

export function computeWebBounds(
  winW: number,
  winH: number,
  topBarHeight: number = TOP_BAR_HEIGHT
): ContentBounds {
  return {
    x: SIDEBAR_WIDTH,
    y: topBarHeight,
    width: Math.max(0, winW - SIDEBAR_WIDTH),
    height: Math.max(0, winH - topBarHeight)
  }
}
