import { useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from '../store'

/**
 * 悬浮日志窗口整页内容（log-window.ts 以 hash='#logs' 加载本入口）。
 * 头部为拖拽区（-webkit-app-region: drag），可拖动小窗；日志数据由
 * store 的 init() 订阅 EvtLog 提供（与主窗同一推送通道）。
 */
export function LogOverlay(): JSX.Element {
  const logs = useStore((s) => s.logs)
  const ref = useRef<HTMLDivElement>(null)
  const [frozen, setFrozen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (el && !frozen) el.scrollTop = el.scrollHeight
  }, [logs, frozen])

  return (
    <div className="floatlog">
      <div className="floatlog-head">
        <span className="t">运行日志（悬浮）</span>
        <span className="spacer" />
        <button className="tiny" onClick={() => setFrozen(!frozen)}>
          {frozen ? '继续滚动' : '暂停滚动'}
        </button>
        <button className="tiny" title="清空当前显示" onClick={() => useStore.setState({ logs: [] })}>
          清空
        </button>
        <button className="tiny" title="关闭悬浮日志" onClick={() => window.close()}>
          ×
        </button>
      </div>
      <div className="logbox floatlog-body" ref={ref}>
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
