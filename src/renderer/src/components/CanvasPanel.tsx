import { useState, type JSX } from 'react'
import type { CanvasInfo, CanvasSelection } from '@shared/types'
import { useStore } from '../store'
import { api } from '../api'

export function CanvasPanel(): JSX.Element {
  const canvases = useStore((s) => s.canvases)
  const bestIndex = useStore((s) => s.bestIndex)
  const selection = useStore((s) => s.canvasSelection)
  const setCanvases = useStore((s) => s.setCanvases)
  const setCanvasSelection = useStore((s) => s.setCanvasSelection)
  const [busy, setBusy] = useState(false)
  const [selectorInput, setSelectorInput] = useState('')

  const probe = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.probeCanvases()
      setCanvases(r.canvases, r.bestIndex, r.selection)
    } finally {
      setBusy(false)
    }
  }

  const select = async (sel: CanvasSelection): Promise<void> => {
    const info = await api.selectCanvas(sel)
    if (info) setCanvasSelection(sel)
  }

  const isSelected = (c: CanvasInfo): boolean => {
    if (!selection) return false
    if (selection.kind === 'index') return selection.index === c.index
    return selection.selector === c.selector
  }

  return (
    <div className="panel">
      <h3>Canvas 探测</h3>
      <p className="hint">
        自动枚举页面全部 Canvas，结合双帧画面差分找出"正在渲染的游戏画布"；也可以手动选择或输入 CSS 选择器。
      </p>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => void probe()}>
          {busy ? '探测中…（双帧采样）' : '自动探测'}
        </button>
        <button onClick={() => void api.probeCurrent().then((r) => setCanvases(r.canvases, bestIndex, r.selection))}>
          刷新
        </button>
      </div>

      {canvases.length === 0 && <p className="hint">当前页面未发现 Canvas，请先导航到游戏页面。</p>}

      {canvases.map((c) => (
        <div key={c.selector} className={'card' + (isSelected(c) ? ' selected' : '')}>
          <div className="row">
            <span className={'badge ' + (c.contextType.startsWith('webgl') ? 'webgl' : c.contextType === 'unknown' ? 'unknown' : '')}>
              {c.contextType}
            </span>
            <b>{c.id || `canvas[${c.index}]`}</b>
            {c.index === bestIndex && <span className="badge">最可能是游戏画布</span>}
            <span className="spacer" />
            <button
              className="tiny primary"
              onClick={() => void select({ kind: 'index', index: c.index })}
            >
              {isSelected(c) ? '已选用' : '选用'}
            </button>
          </div>
          <div className="kv">
            <span>内部分辨率</span>
            <b>
              {c.width}×{c.height}
            </b>
          </div>
          <div className="kv">
            <span>页面位置/尺寸</span>
            <b>
              {Math.round(c.rect.x)},{Math.round(c.rect.y)} {Math.round(c.rect.width)}×
              {Math.round(c.rect.height)}
            </b>
          </div>
          <div className="kv">
            <span>画面变化率 / 评分</span>
            <b>
              {(c.activity * 100).toFixed(1)}% / {c.score}
            </b>
          </div>
          <div className="kv">
            <span>选择器</span>
            <b title={c.selector} style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
              {c.selector}
            </b>
          </div>
        </div>
      ))}

      <div className="section-title">手动 CSS 选择器</div>
      <div className="row">
        <input
          style={{ flex: 1 }}
          placeholder="例如 #game-canvas"
          value={selectorInput}
          onChange={(e) => setSelectorInput(e.target.value)}
        />
        <button
          onClick={() => selectorInput.trim() && void select({ kind: 'selector', selector: selectorInput.trim() })}
        >
          应用
        </button>
      </div>

      <div className="card">
        <div className="kv">
          <span>当前选用</span>
          <b>{selection ? (selection.kind === 'index' ? `索引 ${selection.index}` : selection.selector) : '无'}</b>
        </div>
      </div>
    </div>
  )
}
