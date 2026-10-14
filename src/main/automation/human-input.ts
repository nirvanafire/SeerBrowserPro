/**
 * 拟人化输入：通过 webContents.sendInputEvent 派发 Chromium 输入管线事件
 * （Canvas 游戏可接收到 isTrusted 事件）。包含贝塞尔轨迹、按键时长抖动、点击间隔。
 */
import type { WebContents } from 'electron'
import type { ActionType } from '@shared/types'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 生成带随机控制点抖动的三次贝塞尔移动轨迹 */
function bezierPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  steps: number
): Array<{ x: number; y: number }> {
  const dx = x1 - x0
  const dy = y1 - y0
  const cx1 = x0 + dx * 0.3 + rand(-30, 30)
  const cy1 = y0 + dy * 0.1 + rand(-30, 30)
  const cx2 = x0 + dx * 0.7 + rand(-30, 30)
  const cy2 = y0 + dy * 0.9 + rand(-30, 30)
  const ease = (t: number): number => t * t * (3 - 2 * t)
  const points: Array<{ x: number; y: number }> = []
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps)
    const mt = 1 - t
    const x = mt ** 3 * x0 + 3 * mt ** 2 * t * cx1 + 3 * mt * t ** 2 * cx2 + t ** 3 * x1
    const y = mt ** 3 * y0 + 3 * mt ** 2 * t * cy1 + 3 * mt * t ** 2 * cy2 + t ** 3 * y1
    points.push({ x: Math.round(x + rand(-1, 1)), y: Math.round(y + rand(-1, 1)) })
  }
  return points
}

let virtualX: number | null = null
let virtualY: number | null = null

export async function humanMove(wc: WebContents, x: number, y: number): Promise<void> {
  const startX = virtualX ?? clamp(x + rand(-120, -40), 0, x)
  const startY = virtualY ?? clamp(y + rand(-80, 80), 0, y)
  const dist = Math.hypot(x - startX, y - startY)
  const steps = Math.max(6, Math.min(28, Math.round(dist / 18)))
  const path = bezierPath(startX, startY, x, y, steps)
  for (const p of path) {
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) })
    await sleep(rand(6, 18))
  }
  virtualX = x
  virtualY = y
}

export async function pressClick(
  wc: WebContents,
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  clickCount = 1
): Promise<void> {
  await humanMove(wc, x, y)
  await sleep(rand(30, 90))
  wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount })
  await sleep(rand(45, 110))
  wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount })
  await sleep(rand(40, 120))
}

/** 统一动作入口 */
export async function performAction(
  wc: WebContents,
  action: ActionType,
  x: number,
  y: number,
  viewW: number,
  viewH: number
): Promise<void> {
  const cx = Math.round(clamp(x, 2, viewW - 2))
  const cy = Math.round(clamp(y, 2, viewH - 2))
  switch (action) {
    case 'click':
      await pressClick(wc, cx, cy, 'left', 1)
      break
    case 'dblclick':
      await pressClick(wc, cx, cy, 'left', 1)
      await sleep(rand(40, 90))
      await pressClick(wc, cx, cy, 'left', 2)
      break
    case 'rightclick':
      await pressClick(wc, cx, cy, 'right', 1)
      break
    case 'drag':
      // v1：向斜下方短拖（适用于拖拽类建筑/滑块）
      await humanMove(wc, cx, cy)
      wc.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 })
      await sleep(80)
      const ex = cx + Math.round(rand(40, 90))
      const ey = cy + Math.round(rand(20, 60))
      for (const p of bezierPath(cx, cy, ex, ey, 10)) {
        wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
        await sleep(rand(10, 22))
      }
      wc.sendInputEvent({ type: 'mouseUp', x: ex, y: ey, button: 'left', clickCount: 1 })
      break
  }
}
