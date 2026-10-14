import { useEffect, useState, type JSX } from 'react'
import { api, type DatasetInfo } from '../api'

/** 侧栏「标注」页：入口 + 数据集概览。完整标注在独立工作台窗口进行。 */
export function AnnotatorEntry(): JSX.Element {
  const [info, setInfo] = useState<DatasetInfo | null>(null)

  useEffect(() => {
    void api.datasetInfo().then(setInfo)
  }, [])

  return (
    <div className="panel">
      <h3>人工标注 → YOLO 数据集</h3>
      <p className="hint">
        标注在独立的「标注工作台」窗口进行：画面更大，支持缩放、框列表管理与撤销。
        工作台抓取的始终是主窗当前活动标签的游戏画面。
      </p>
      <div className="row">
        <button className="primary" onClick={() => void api.openAnnotator()}>
          打开标注工作台
        </button>
        <button onClick={() => void api.openUserData('dataset')}>数据集目录</button>
      </div>
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
      <p className="hint">标签导出为 YOLO 归一化 txt（供 Python 端训练 yolo26）。</p>
    </div>
  )
}
