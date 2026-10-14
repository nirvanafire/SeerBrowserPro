/**
 * 主窗布局常量（React 控制面板与内嵌网页视图的边界契约）。
 * React UI 占据 L 形区域：顶部通栏 + 左侧边栏；网页视图占据右下矩形。
 * 修改这些值时必须同步 src/renderer 的样式变量。
 */
export const TOP_BAR_HEIGHT = 84
export const SIDEBAR_WIDTH = 360

export interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
}

export function computeWebBounds(winW: number, winH: number): ContentBounds {
  return {
    x: SIDEBAR_WIDTH,
    y: TOP_BAR_HEIGHT,
    width: Math.max(0, winW - SIDEBAR_WIDTH),
    height: Math.max(0, winH - TOP_BAR_HEIGHT)
  }
}
