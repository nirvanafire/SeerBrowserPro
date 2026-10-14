import { useEffect, type JSX } from 'react'
import { useStore } from './store'
import { BrowserChrome } from './components/BrowserChrome'
import { CanvasPanel } from './components/CanvasPanel'
import { DetectPanel } from './components/DetectPanel'
import { ModelPanel } from './components/ModelPanel'
import { CachePanel } from './components/CachePanel'
import { TaskPanel } from './components/TaskPanel'
import { Annotator } from './components/Annotator'
import { LogPanel } from './components/LogPanel'

const NAV: Array<{ key: ReturnType<typeof useStore.getState>['panel']; label: string }> = [
  { key: 'canvas', label: '画布' },
  { key: 'detect', label: '检测' },
  { key: 'model', label: '模型' },
  { key: 'cache', label: '缓存' },
  { key: 'task', label: '任务' },
  { key: 'annotate', label: '标注' },
  { key: 'log', label: '日志' }
]

export default function App(): JSX.Element {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)

  useEffect(() => init(), [init])

  return (
    <div className="app">
      <BrowserChrome />
      <div className="body">
        <div className="sidebar">
          <div className="side-nav">
            {NAV.map((n) => (
              <button
                key={n.key}
                className={panel === n.key ? 'active' : ''}
                onClick={() => setPanel(n.key)}
              >
                {n.label}
              </button>
            ))}
          </div>
          {ready && (
            <>
              {panel === 'canvas' && <CanvasPanel />}
              {panel === 'detect' && <DetectPanel />}
              {panel === 'model' && <ModelPanel />}
              {panel === 'cache' && <CachePanel />}
              {panel === 'task' && <TaskPanel />}
              {panel === 'annotate' && <Annotator />}
              {panel === 'log' && <LogPanel />}
            </>
          )}
        </div>
        {/* 右侧由主进程挂载的 WebContentsView 原生覆盖，此处仅占位 */}
        <div className="spacer" style={{ background: '#0b101b' }} />
      </div>
    </div>
  )
}
