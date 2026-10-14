import { useEffect, useRef, type JSX } from 'react'
import { useStore } from '../store'

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
