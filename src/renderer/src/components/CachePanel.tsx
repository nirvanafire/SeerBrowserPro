import { useState, type JSX } from 'react'
import type { CachedPage, GameModule } from '@shared/types'
import { useStore } from '../store'
import { api } from '../api'

function norm(b: { x1: number; y1: number; x2: number; y2: number } | null): string {
  if (!b) return '—'
  return `${b.x1.toFixed(2)},${b.y1.toFixed(2)} → ${b.x2.toFixed(2)},${b.y2.toFixed(2)}`
}

function ModuleRow({ page, module: m }: { page: CachedPage; module: GameModule }): JSX.Element {
  const [draft, setDraft] = useState(m)
  const dirty =
    draft.label !== m.label || draft.action !== m.action || draft.locked !== m.locked

  const save = async (): Promise<void> => {
    await api.updateModule(page.id, { ...m, ...draft })
  }

  return (
    <div className="card">
      <div className="row">
        <input
          style={{ width: 110 }}
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        <select
          value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value as GameModule['action'] })}
        >
          <option value="click">单击</option>
          <option value="dblclick">双击</option>
          <option value="rightclick">右键</option>
          <option value="drag">拖拽</option>
        </select>
        <span className="spacer" />
        <button className="tiny" disabled={!dirty} onClick={() => void save()}>
          保存
        </button>
        <button
          className="tiny danger"
          onClick={() => void api.deleteModule(page.id, m.id)}
        >
          删除
        </button>
      </div>
      <div className="kv">
        <span>classId / 置信度 / 命中</span>
        <b>
          {m.classId} / {(m.confidence * 100).toFixed(0)}% / {m.hitCount}
        </b>
      </div>
      <div className="kv">
        <span>Canvas 归一化</span>
        <b>{norm(m.bboxCanvasNorm)}</b>
      </div>
      <div className="kv">
        <span>视口归一化</span>
        <b>{norm(m.bboxViewportNorm)}</b>
      </div>
      <div className="kv">
        <span>模板缩略图</span>
        <b>{m.template.length > 0 ? `${m.template.length} 灰度值` : '无'}</b>
      </div>
      <label className="inline" style={{ marginTop: 4 }}>
        <input
          type="checkbox"
          checked={draft.locked}
          onChange={(e) => setDraft({ ...draft, locked: e.target.checked })}
        />
        锁定（坐标不被自动更新）
      </label>
    </div>
  )
}

export function CachePanel(): JSX.Element {
  const pages = useStore((s) => s.pages)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="panel">
      <h3>功能模块缓存</h3>
      <p className="hint">
        缓存按"页面签名"组织（origin+路径、DOM 摘要、截图感知哈希三级匹配）。模块存归一化坐标，窗口缩放后仍可正确点击。
      </p>
      <button onClick={() => void api.listPages().then(useStore.getState().setPages)}>刷新</button>
      <button onClick={() => void api.openUserData('cache')}>打开缓存目录</button>

      {pages.length === 0 && <p className="hint">暂无缓存。检测到目标后点「存为模块」，或运行任务时自动登记。</p>}

      {pages.map((p) => (
        <div key={p.id} className="card">
          <div className="row">
            <button className="tiny" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
              {openId === p.id ? '▾' : '▸'} {p.modules.length} 个模块
            </button>
            <b title={p.signature.origin + p.signature.pathPattern} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.signature.origin.replace(/^https?:\/\//, '')}
              {p.signature.pathPattern}
            </b>
            <span className="spacer" />
            <button className="tiny danger" onClick={() => void api.deletePage(p.id)}>
              清空页面
            </button>
          </div>
          <div className="kv">
            <span>标题 / 更新时间</span>
            <b>
              {p.signature.title || '(无标题)'} · {new Date(p.updatedAt).toLocaleString()}
            </b>
          </div>
          {openId === p.id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {p.modules.map((m) => (
                <ModuleRow key={m.id} page={p} module={m} />
              ))}
              {p.modules.length === 0 && <p className="hint">空页面</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
