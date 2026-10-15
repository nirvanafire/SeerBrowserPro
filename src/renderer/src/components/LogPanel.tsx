import { useEffect, useRef, type JSX } from 'react'
import { useStore } from '../store'
import { api } from '../api'

export function LogPanel(): JSX.Element {
  const logs = useStore((s) => s.logs)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <div className="panel" style={{ display: 'flex', minHeight: 0 }}>
      <h3>运行日志</h3>
      <p className="hint">包含探测、推理、缓存命中、点击动作与 Python 工具输出。</p>
      <div className="row">
        <button className="primary" onClick={() => void api.toggleLogWindow()}>
          打开悬浮日志
        </button>
        <span className="hint">置顶小窗，测试功能时实时查看</span>
      </div>
      <div className="logbox" ref={ref}>
        {logs.map((l, i) => (
          <div key={i} className={'logline ' + l.level}>
            <span className="t">{new Date(l.time).toLocaleTimeString()} </span>
            {l.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
