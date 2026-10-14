import { useEffect, useRef, useState, type JSX } from 'react'
import type { AnnotationBox, BBox, CaptureFrame } from '@shared/types'
import { api } from '../api'

interface DraftRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function Annotator(): JSX.Element {
  const [frame, setFrame] = useState<CaptureFrame | null>(null)
  const [boxes, setBoxes] = useState<AnnotationBox[]>([])
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [label, setLabel] = useState('target')
  const [info, setInfo] = useState<{ classes: string[]; sampleCount: number; root: string } | null>(null)
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
  }

  /** 鼠标像素 → CSS 视口坐标 */
  const toCss = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = ref.current
    if (!el || !frame) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    const fx = (clientX - r.left) / r.width
    const fy = (clientY - r.top) / r.height
    return { x: fx * frame.cssWidth, y: fy * frame.cssHeight }
  }

  const onDown = (e: React.MouseEvent): void => {
    startRef.current = toCss(e.clientX, e.clientY)
  }
  const onMove = (e: React.MouseEvent): void => {
    if (!startRef.current) return
    const p = toCss(e.clientX, e.clientY)
    setDraft({ x1: startRef.current.x, y1: startRef.current.y, x2: p.x, y2: p.y })
  }
  const onUp = (): void => {
    if (draft && Math.abs(draft.x2 - draft.x1) > 4 && Math.abs(draft.y2 - draft.y1) > 4) {
      const box: BBox = {
        x1: Math.min(draft.x1, draft.x2),
        y1: Math.min(draft.y1, draft.y2),
        x2: Math.max(draft.x1, draft.x2),
        y2: Math.max(draft.y1, draft.y2)
      }
      setBoxes((b) => [...b, { label: label.trim() || 'unknown', css: box }])
    }
    startRef.current = null
    setDraft(null)
  }

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
  }

  return (
    <div className="panel">
      <h3>人工标注 → YOLO 数据集</h3>
      <p className="hint">
        冻结一帧后在画面上拖拽框选功能元素，标签将导出为 YOLO 归一化 txt（供 Python 端训练 yolo26）。
      </p>
      <div className="row">
        <button className="primary" onClick={() => void grab()}>
          抓取当前帧
        </button>
        <button disabled={boxes.length === 0} onClick={() => void save()}>
          保存 {boxes.length > 0 ? `(${boxes.length})` : ''}
        </button>
        <button onClick={() => setBoxes([])}>清除标注</button>
        <button onClick={() => void api.openUserData('dataset')}>数据集目录</button>
      </div>
      <div className="row">
        <input
          style={{ flex: 1 }}
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
      </div>

      {frame ? (
        <div
          ref={ref}
          className="annotator"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
        >
          <img src={frame.dataUrl} draggable={false} />
          {boxes.map((b, i) => (
            <div key={i} className="annot-box" style={boxStyle(b.css)}>
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
        <p className="hint">点击「抓取当前帧」开始标注。</p>
      )}

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
  )
}
