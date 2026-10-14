import { useState, type JSX } from 'react'
import type { Detection } from '@shared/types'
import { useStore } from '../store'
import { api } from '../api'

/** 单个检测目标行：命中功能点时显示功能点名，否则显示模型类别名 */
function DetectionRow({
  d,
  index,
  onSaved
}: {
  d: Detection
  index: number
  onSaved: () => Promise<void>
}): JSX.Element {
  return (
    <div className="det-item">
      <div className="row">
        {d.moduleId ? (
          <span className="badge module">功能点</span>
        ) : (
          <span className="badge unknown">未入库</span>
        )}
        <span className="name">{d.moduleLabel ?? d.label}</span>
        <span className="badge">{(d.confidence * 100).toFixed(0)}%</span>
        <span className="spacer" />
        <button className="tiny primary" onClick={() => void api.clickDetection(index)}>
          点它
        </button>
        {!d.moduleId && (
          <button
            className="tiny"
            onClick={async () => {
              await api.saveDetectionModule(d)
              await onSaved()
            }}
          >
            存为功能点
          </button>
        )}
      </div>
      <div className="meta">
        {d.moduleId
          ? `类别 ${d.label} · 累计命中 ${d.moduleHits ?? 0} 次 · `
          : ''}
        css({Math.round(d.css.x1)},{Math.round(d.css.y1)})-({Math.round(d.css.x2)},
        {Math.round(d.css.y2)})
        {d.canvasNorm
          ? ` canvasNorm(${d.canvasNorm.x1.toFixed(2)},${d.canvasNorm.y1.toFixed(2)})`
          : ''}
      </div>
    </div>
  )
}

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

  // 保留 detections 原数组下标（clickDetection 按下标定位）
  const indexed = (result?.detections ?? []).map((d, i) => ({ d, i }))
  const matchedDets = indexed.filter((x) => x.d.moduleId)
  const unmatchedDets = indexed.filter((x) => !x.d.moduleId)
  const pageModules = result?.pageModules ?? []
  const missedModules = pageModules.filter((m) => !matchedDets.some((x) => x.d.moduleId === m.id))

  return (
    <div className="panel">
      <h3>实时检测</h3>
      <p className="hint">
        当前模型：<b>{activeModel?.name ?? '未选择'}</b>（{activeModel?.classes.length ?? 0} 类）。
        检测结果自动与当前页的缓存功能点匹配，命中后按功能点操作。
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
            <div className="num">{matchedDets.length}</div>
            <div className="lbl">命中功能点</div>
          </div>
          <div className="box">
            <div className="num">{result.inferenceMs.toFixed(0)}ms</div>
            <div className="lbl">模型推理</div>
          </div>
          <div className="box">
            <div className="num">{result.totalMs.toFixed(0)}ms</div>
            <div className="lbl">总耗时</div>
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

      {matchedDets.length > 0 && (
        <>
          <div className="section-title">已识别功能点（{matchedDets.length}）</div>
          {matchedDets.map(({ d, i }) => (
            <DetectionRow key={i} d={d} index={i} onSaved={refreshPages} />
          ))}
        </>
      )}

      {unmatchedDets.length > 0 && (
        <>
          <div className="section-title">未入库目标（{unmatchedDets.length}）</div>
          {unmatchedDets.map(({ d, i }) => (
            <DetectionRow key={i} d={d} index={i} onSaved={refreshPages} />
          ))}
        </>
      )}

      {missedModules.length > 0 && (
        <>
          <div className="section-title">本轮未出现的功能点（{missedModules.length}）</div>
          {missedModules.map((m) => (
            <div key={m.id} className="det-item missed">
              <div className="row">
                <span className="badge module">缓存</span>
                <span className="name">{m.label}</span>
                <span className="badge">{m.action}</span>
                <span className="spacer" />
                <button
                  className="tiny primary"
                  onClick={() => void api.clickModule(result!.pageId!, m.id)}
                >
                  点它
                </button>
              </div>
              <div className="meta">
                累计命中 {m.hitCount} 次 · 最近出现{' '}
                {m.lastSeen ? new Date(m.lastSeen).toLocaleTimeString() : '—'}
              </div>
            </div>
          ))}
        </>
      )}

      {result?.ok && result.detections.length === 0 && pageModules.length === 0 && (
        <p className="hint">本轮未检测到目标。当前页还没有缓存功能点，可先在「缓存」面板查看。</p>
      )}
    </div>
  )
}
