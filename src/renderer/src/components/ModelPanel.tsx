import { useState, type JSX } from 'react'
import type { ModelManifest } from '@shared/types'
import { useStore } from '../store'
import { api } from '../api'

export function ModelPanel(): JSX.Element {
  const models = useStore((s) => s.models)
  const activeId = useStore((s) => s.activeModelId)
  const modelsDir = useStore((s) => s.modelsDir)
  const setModels = useStore((s) => s.setModels)
  const [busy, setBusy] = useState('')

  const refresh = async (): Promise<void> => {
    const m = await api.listModels()
    setModels(m.models, m.activeId, m.modelsDir)
  }

  const patchModel = async (m: ModelManifest, patch: Partial<ModelManifest>): Promise<void> => {
    await api.updateModel(m.id, patch)
    await refresh()
  }

  return (
    <div className="panel">
      <h3>YOLO26 模型</h3>
      <p className="hint">
        支持 YOLO26 detect 导出的 ONNX：推荐 nms=False 端到端头（输出 300×6，无需 NMS）；默认头（4+nc 通道）也兼容。
      </p>
      <div className="row wrap">
        <button
          className="primary"
          disabled={busy !== ''}
          onClick={async () => {
            setBusy('import')
            await api.importModel()
            await refresh()
            setBusy('')
          }}
        >
          导入 ONNX (+classes.json)
        </button>
        <button
          disabled={busy !== ''}
          title="用 Python onnx 包生成假模型，零网络验证推理链路"
          onClick={async () => {
            setBusy('dummy')
            await api.generateDummy()
            await refresh()
            setBusy('')
          }}
        >
          {busy === 'dummy' ? '生成中…（见日志）' : '生成离线演示模型'}
        </button>
        <button
          disabled={busy !== ''}
          title="pip 安装 ultralytics，下载 yolo26n.pt 并导出 ONNX"
          onClick={async () => {
            setBusy('official')
            await api.fetchOfficial()
            await refresh()
            setBusy('')
          }}
        >
          {busy === 'official' ? '下载导出中…（见日志）' : '获取官方 yolo26n'}
        </button>
      </div>
      <button onClick={() => void api.openUserData('models')}>打开模型目录</button>

      {models.length === 0 && (
        <div className="card">
          <p className="hint">
            尚无模型。建议先点「生成离线演示模型」跑通流程；真实游戏请在 Python 工具包中用自定义数据训练后导出（见「开发清单」文档）。
          </p>
        </div>
      )}

      {models.map((m) => (
        <div key={m.id} className={'card' + (m.id === activeId ? ' selected' : '')}>
          <div className="row">
            <input
              type="radio"
              checked={m.id === activeId}
              onChange={() => void api.selectModel(m.id).then(refresh)}
            />
            <b>{m.name}</b>
            {m.builtin && <span className="badge">内置</span>}
            <span className="spacer" />
            <button className="tiny danger" onClick={() => void api.removeModel(m.id).then(refresh)}>
              删除
            </button>
          </div>
          <div className="kv">
            <span>检测头 / 输入</span>
            <b>
              {m.head} / {m.inputSize}
            </b>
          </div>
          <div className="kv">
            <span>类别数</span>
            <b>{m.classes.length}</b>
          </div>
          <div className="kv">
            <span>类别预览</span>
            <b title={m.classes.join(', ')} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {m.classes.slice(0, 6).join(', ')}
              {m.classes.length > 6 ? '…' : ''}
            </b>
          </div>
          {m.id === activeId && (
            <>
              <div className="row" style={{ marginTop: 6 }}>
                <label className="inline" style={{ flex: 1 }}>
                  conf {m.confThreshold.toFixed(2)}
                  <input
                    type="range"
                    min={0.05}
                    max={0.95}
                    step={0.05}
                    defaultValue={m.confThreshold}
                    style={{ flex: 1 }}
                    onChange={(e) => void patchModel(m, { confThreshold: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="row">
                <label className="inline" style={{ flex: 1 }}>
                  iou {m.iouThreshold.toFixed(2)}
                  <input
                    type="range"
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    defaultValue={m.iouThreshold}
                    style={{ flex: 1 }}
                    onChange={(e) => void patchModel(m, { iouThreshold: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="row">
                <label className="inline">检测头</label>
                <select
                  value={m.head}
                  onChange={(e) => void patchModel(m, { head: e.target.value as ModelManifest['head'] })}
                >
                  <option value="auto">auto（自动识别）</option>
                  <option value="e2e">e2e（nms=False，300×6）</option>
                  <option value="standard">standard（默认头 + NMS）</option>
                </select>
              </div>
            </>
          )}
        </div>
      ))}
      <p className="hint">模型目录：{modelsDir}</p>
    </div>
  )
}
