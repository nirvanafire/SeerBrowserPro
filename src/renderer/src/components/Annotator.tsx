import { useEffect, useRef, useState, type JSX } from 'react'
import type { AnnotationBox, BBox, CaptureFrame } from '@shared/types'
import { api } from '../api'

interface DraftRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

/**
 * 标注工作台（独立大窗口，hash='#annotator' 时整页渲染）。
 * 支持缩放、滚轮缩放、框列表管理（选中高亮/单删/撤销）。
 * 抓帧仍取主窗活动标签的游戏画面，保存走原有 annotate:save IPC。
 */
export function Annotator(): JSX.Element {
  const [frame, setFrame] = useState<CaptureFrame | null>(null)
  const [boxes, setBoxes] = useState<AnnotationBox[]>([])
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [label, setLabel] = useState('target')
  const [info, setInfo] = useState<{ classes: string[]; sampleCount: number; root: string } | null>(null)
  /** null = 适应窗口宽度；否则为显示倍率（0.25~4） */
  const [zoom, setZoom] = useState<number | null>(null)
  const [selected, setSelected] = useState<number>(-1)
  const ref = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    void api.datasetInfo().then(setInfo)
  }, [])

  const grab = async (): Promise<void> => {
    const f = await api.captureFrame()
    setFrame(f)
    setBoxes([])
    setDraft(null)
    setSelected(-1)
  }

  /** 鼠标像素 → CSS 视口坐标（按图片显示矩形比例换算，天然兼容缩放与滚动） */
  const toCss = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = ref.current
    if (!el || !frame) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    const fx = (clientX - r.left) / r.width
    const fy = (clientY - r.top) / r.height
    return {
      x: Math.min(frame.cssWidth, Math.max(0, fx * frame.cssWidth)),
      y: Math.min(frame.cssHeight, Math.max(0, fy * frame.cssHeight))
    }
  }

  const onDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    startRef.current = toCss(e.clientX, e.clientY)
    setSelected(-1)
  }
  const onMove = (e: React.MouseEvent): void => {
    if (!startRef.current) return
    const p = toCss(e.clientX, e.clientY)
    setDraft({ x1: startRef.current.x, y1: startRef.current.y, x2: p.x, y2: p.y })
  }
  const finishDraft = (): void => {
    if (draft && Math.abs(draft.x2 - draft.x1) > 4 && Math.abs(draft.y2 - draft.y1) > 4) {
      const box: BBox = {
        x1: Math.min(draft.x1, draft.x2),
        y1: Math.min(draft.y1, draft.y2),
        x2: Math.max(draft.x1, draft.x2),
        y2: Math.max(draft.y1, draft.y2)
      }
      setBoxes((b) => [...b, { label: label.trim() || 'unknown', css: box }])
      setSelected(boxes.length)
    }
    startRef.current = null
    setDraft(null)
  }

  // 拖拽可能移出图片区域：在 window 上收尾
  useEffect(() => {
    const up = (): void => finishDraft()
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  })

  const onWheel = (e: React.WheelEvent): void => {
    if (!frame) return
    const cur = zoom ?? fitZoom()
    const next = clampZoom(cur + (e.deltaY < 0 ? 0.25 : -0.25))
    setZoom(next)
  }

  const fitZoom = (): number => {
    if (!frame) return 1
    const stage = ref.current?.parentElement
    if (!stage) return 1
    return Math.min(1, (stage.clientWidth - 24) / frame.cssWidth)
  }

  const clampZoom = (z: number): number => Math.min(4, Math.max(0.25, z))

  const boxStyle = (b: BBox): React.CSSProperties =>
    frame
      ? {
          left: `${(b.x1 / frame.cssWidth) * 100}%`,
          top: `${(b.y1 / frame.cssHeight) * 100}%`,
          width: `${((b.x2 - b.x1) / frame.cssWidth) * 100}%`,
          height: `${((b.y2 - b.y1) / frame.cssHeight) * 100}%`
        }
      : {}

  const save = async (): Promise<void> => {
    if (!frame) return
    const d = await api.saveAnnotations(frame, boxes)
    setInfo(d)
    setBoxes([])
    setSelected(-1)
  }

  const removeBox = (i: number): void => {
    setBoxes((b) => b.filter((_, idx) => idx !== i))
    setSelected(-1)
  }

  const zoomPct = Math.round((zoom ?? fitZoom()) * 100)

  return (
    <div className="workshop">
      <div className="ws-toolbar">
        <button className="primary" onClick={() => void grab()}>
          抓取游戏画面
        </button>
        <button disabled={!frame || boxes.length === 0} onClick={() => void save()}>
          保存样本{boxes.length > 0 ? ` (${boxes.length})` : ''}
        </button>
        <button
          disabled={boxes.length === 0}
          onClick={() => {
            setBoxes((b) => b.slice(0, -1))
            setSelected(-1)
          }}
        >
          撤销
        </button>
        <button disabled={boxes.length === 0} onClick={() => { setBoxes([]); setSelected(-1) }}>
          清除
        </button>
        <input
          style={{ width: 160 }}
          value={label}
          placeholder="标签名，如 start_button"
          onChange={(e) => setLabel(e.target.value)}
          list="seer-labels"
        />
        <datalist id="seer-labels">
          {(info?.classes ?? ['target', 'button', 'coin', 'dialog']).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <span className="spacer" />
        <button className="tiny" onClick={() => setZoom(clampZoom((zoom ?? fitZoom()) - 0.25))}>−</button>
        <span className="hint" style={{ minWidth: 44, textAlign: 'center' }}>{zoomPct}%</span>
        <button className="tiny" onClick={() => setZoom(clampZoom((zoom ?? fitZoom()) + 0.25))}>＋</button>
        <button className="tiny" onClick={() => setZoom(1)}>100%</button>
        <button className="tiny" onClick={() => setZoom(null)}>适应宽度</button>
        <button onClick={() => void api.openUserData('dataset')}>数据集目录</button>
      </div>

      <div className="ws-body">
        <div className="ws-stage" onWheel={onWheel}>
          {frame ? (
            <div
              ref={ref}
              className="annotator"
              style={{ width: zoom === null ? '100%' : frame.cssWidth * zoom }}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={finishDraft}
            >
              <img src={frame.dataUrl} draggable={false} />
              {boxes.map((b, i) => (
                <div
                  key={i}
                  className={'annot-box' + (i === selected ? ' selected' : '')}
                  style={boxStyle(b.css)}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setSelected(i)
                  }}
                >
                  <span>{b.label}</span>
                </div>
              ))}
              {draft && (
                <div
                  className="annot-box"
                  style={{ borderColor: '#f7b500', ...boxStyle({
                    x1: Math.min(draft.x1, draft.x2),
                    y1: Math.min(draft.y1, draft.y2),
                    x2: Math.max(draft.x1, draft.x2),
                    y2: Math.max(draft.y1, draft.y2)
                  }) }}
                />
              )}
            </div>
          ) : (
            <p className="hint" style={{ padding: 24 }}>
              点击「抓取游戏画面」冻结主窗当前游戏帧，然后在画面上拖拽框选功能元素。
              滚轮可缩放，点击已有框可选中。
            </p>
          )}
        </div>

        <div className="ws-side">
          <div className="section-title">标注框（{boxes.length}）</div>
          {boxes.map((b, i) => (
            <div
              key={i}
              className={'ws-box-row' + (i === selected ? ' selected' : '')}
              onClick={() => setSelected(i)}
            >
              <span className="name">#{i + 1} {b.label}</span>
              <span className="hint">
                {Math.round(b.css.x2 - b.css.x1)}×{Math.round(b.css.y2 - b.css.y1)}
              </span>
              <button className="tiny danger" onClick={(e) => { e.stopPropagation(); removeBox(i) }}>
                删
              </button>
            </div>
          ))}
          {boxes.length === 0 && <p className="hint">尚无标注框。</p>}

          <div className="section-title" style={{ marginTop: 12 }}>数据集</div>
          <div className="card">
            <div className="kv">
              <span>已标注样本</span>
              <b>{info?.sampleCount ?? 0} 张</b>
            </div>
            <div className="kv">
              <span>标签</span>
              <b>{(info?.classes ?? []).join(', ') || '（无）'}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
