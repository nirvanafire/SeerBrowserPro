/**
 * 页面覆盖层：向游戏页面注入 position:fixed 的透明 DOM 层，
 * 绘制 YOLO 检测框 / 缓存模块框。pointerEvents:none，不影响游戏交互。
 */
import type { WebContents } from 'electron'

export interface OverlayItem {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  confidence?: number
  /** detect=实时检测（绿）；module=缓存模块（蓝）；target=即将点击（红） */
  kind: 'detect' | 'module' | 'target'
}

const COLORS: Record<OverlayItem['kind'], string> = {
  detect: '#22d65f',
  module: '#3b9dff',
  target: '#ff4d4f'
}

function hashHue(label: string): number {
  let h = 0
  for (let i = 0; i < label.length; i++) h = (Math.imul(h, 31) + label.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

export async function renderOverlay(wc: WebContents, items: OverlayItem[]): Promise<void> {
  const payload = items.map((it) => ({
    x: Math.round(it.x1),
    y: Math.round(it.y1),
    w: Math.max(1, Math.round(it.x2 - it.x1)),
    h: Math.max(1, Math.round(it.y2 - it.y1)),
    label: it.label,
    conf: it.confidence != null ? it.confidence.toFixed(2) : '',
    color: it.kind === 'detect' ? `hsl(${hashHue(it.label)},80%,55%)` : COLORS[it.kind],
    fill: it.kind === 'target'
  }))
  const json = JSON.stringify(payload).replace(/<\/script/gi, '<\\/script')
  const code = `(() => {
    const data = ${json};
    let root = document.getElementById('__seer_overlay_root');
    if (!root) {
      root = document.createElement('div');
      root.id = '__seer_overlay_root';
      root.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;overflow:hidden';
      (document.body || document.documentElement).appendChild(root);
    }
    root.innerHTML = '';
    for (const it of data) {
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;left:'+it.x+'px;top:'+it.y+'px;width:'+it.w+'px;height:'+it.h+'px;border:2px solid '+it.color+';box-sizing:border-box;border-radius:2px;' + (it.fill ? 'background:rgba(255,77,79,0.12);' : '');
      const tag = document.createElement('div');
      tag.textContent = it.label + (it.conf ? ' '+it.conf : '');
      tag.style.cssText = 'position:absolute;left:-2px;top:-20px;font:12px/16px monospace;color:#fff;background:'+it.color+';padding:1px 6px;border-radius:3px;white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis';
      box.appendChild(tag);
      root.appendChild(box);
    }
    return true;
  })()`
  try {
    await wc.executeJavaScript(code)
  } catch {
    // 页面未就绪 / 跨域 about:blank 等，忽略
  }
}

export async function clearOverlay(wc: WebContents): Promise<void> {
  try {
    await wc.executeJavaScript(
      `(() => { const r = document.getElementById('__seer_overlay_root'); if (r) r.remove(); return true; })()`
    )
  } catch {
    /* ignore */
  }
}
