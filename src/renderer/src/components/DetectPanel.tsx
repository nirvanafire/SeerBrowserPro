import { useState, type JSX } from 'react'
import { useStore } from '../store'
import { api } from '../api'

export function DetectPanel(): JSX.Element {
  const result = useStore((s) => s.detect)
  const models = useStore((s) => s.models)
  const activeModelId = useStore((s) => s.activeModelId)
  const live = useStore((s) => s.live)
  const interval = useStore((s) => s.liveInterval)
  const setLive = useStore((s) => s.setLive)
  const refreshPages = useStore((s) => s.refresh)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeModel = models.find((m) => m.id === activeModelId)

  const once = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await api.detectOnce()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleLive = async (): Promise<void> => {
    if (live) {
      await api.stopLive()
      setLive(false)
    } else {
      try {
        await api.startLive(interval)
        setLive(true)
        setError('')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  return (
    <div className="panel">
      <h3>实时检测</h3>
      <p className="hint">
        当前模型：<b>{activeModel?.name ?? '未选择'}</b>（{activeModel?.classes.length ?? 0} 类）。检测框直接绘制在游戏页面上（绿框）。
      </p>
      <div className="row">
        <button className="primary" disabled={busy || live} onClick={() => void once()}>
          {busy ? '推理中…' : '单次推理'}
        </button>
        <button onClick={() => void toggleLive()}>{live ? '■ 停止连续检测' : '▶ 连续检测'}</button>
        <button onClick={() => void api.clearOverlay()}>清除框层</button>
      </div>
      <div className="row">
        <label className="inline" style={{ flex: 1 }}>
          间隔 {interval}ms
          <input
            type="range"
            min={500}
            max={5000}
            step={100}
            value={interval}
            style={{ flex: 1 }}
            onChange={(e) => useStore.setState({ liveInterval: Number(e.target.value) })}
          />
        </label>
      </div>

      {result?.ok && (
        <div className="stat">
          <div className="box">
            <div className="num">{result.detections.length}</div>
            <div className="lbl">目标数</div>
          </div>
          <div className="box">
            <div className="num">{result.inferenceMs.toFixed(0)}ms</div>
            <div className="lbl">模型推理</div>
          </div>
          <div className="box">
            <div className="num">{result.totalMs.toFixed(0)}ms</div>
            <div className="lbl">总耗时</div>
          </div>
          <div className="box">
            <div className="num">
              {result.bitmapWidth}×{result.bitmapHeight}
            </div>
            <div className="lbl">截图尺寸</div>
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: '#8a3545' }}>
          <p className="hint" style={{ color: '#ff8587' }}>
            {error}
          </p>
        </div>
      )}

      {result?.detections.map((d, i) => (
        <div key={i} className="det-item">
          <div className="row">
            <span className="name">{d.label}</span>
            <span className="badge">{(d.confidence * 100).toFixed(0)}%</span>
            <span className="spacer" />
            <button className="tiny primary" onClick={() => void api.clickDetection(i)}>
              点它
            </button>
            <button
              className="tiny"
              onClick={async () => {
                await api.saveDetectionModule(d)
                await refreshPages()
              }}
            >
              存为模块
            </button>
          </div>
          <div className="meta">
            css({Math.round(d.css.x1)},{Math.round(d.css.y1)})-({Math.round(d.css.x2)},
            {Math.round(d.css.y2)})
            {d.canvasNorm
              ? ` canvasNorm(${d.canvasNorm.x1.toFixed(2)},${d.canvasNorm.y1.toFixed(2)})`
              : ''}
          </div>
        </div>
      ))}
    </div>
  )
}
