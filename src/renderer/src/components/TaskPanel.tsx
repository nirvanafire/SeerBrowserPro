import { useState, type JSX } from 'react'
import type { AutomationConfig, TaskStep } from '@shared/types'
import { useStore } from '../store'
import { api } from '../api'

const DEFAULT_STEPS: TaskStep[] = [
  { type: 'click', target: 'button', waitAfter: 800 },
  { type: 'wait', ms: 1000 },
  { type: 'verify', target: 'dialog', timeout: 5000 }
]

export function TaskPanel(): JSX.Element {
  const task = useStore((s) => s.task)
  const [mode, setMode] = useState<AutomationConfig['mode']>('loop')
  const [labels, setLabels] = useState('target, button')
  const [stopLabel, setStopLabel] = useState('')
  const [interval, setIntervalMs] = useState(1500)
  const [maxLoops, setMaxLoops] = useState(30)
  const [confidence, setConfidence] = useState(0.35)
  const [dryRun, setDryRun] = useState(true)
  const [stepsText, setStepsText] = useState(JSON.stringify(DEFAULT_STEPS, null, 2))
  const [seqLoop, setSeqLoop] = useState(false)
  const [error, setError] = useState('')

  const start = async (): Promise<void> => {
    setError('')
    const config: AutomationConfig = {
      mode,
      clickLabels: labels
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      stopLabel: stopLabel.trim() || undefined,
      steps: [],
      loop: mode === 'loop' ? true : seqLoop,
      maxLoops: Number(maxLoops),
      tickIntervalMs: Number(interval),
      confidence: Number(confidence),
      dryRun
    }
    if (mode === 'sequence') {
      try {
        const steps = JSON.parse(stepsText) as TaskStep[]
        if (!Array.isArray(steps) || steps.length === 0) throw new Error('步骤必须是非空数组')
        config.steps = steps
      } catch (e) {
        setError('步骤 JSON 解析失败：' + (e instanceof Error ? e.message : String(e)))
        return
      }
    }
    const r = await api.startTask(config)
    if (!r.ok) setError(r.error ?? '启动失败')
  }

  return (
    <div className="panel">
      <h3>自动任务</h3>
      <p className="hint">
        循环模式：每轮截图推理，按标签优先级找到目标即拟人点击。序列模式：按 JSON 步骤执行。任何时刻按 <b>Esc</b> 急停。
      </p>

      <div className="row">
        <label className="inline">
          <input
            type="radio"
            checked={mode === 'loop'}
            onChange={() => setMode('loop')}
          />
          循环点击
        </label>
        <label className="inline">
          <input
            type="radio"
            checked={mode === 'sequence'}
            onChange={() => setMode('sequence')}
          />
          步骤序列
        </label>
      </div>

      {mode === 'loop' ? (
        <>
          <label className="inline">点击目标标签（逗号分隔，按优先级）</label>
          <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="target, button, coin" />
          <label className="inline">停止信号标签（检测到即停，可选）</label>
          <input value={stopLabel} onChange={(e) => setStopLabel(e.target.value)} placeholder="dialog" />
        </>
      ) : (
        <>
          <label className="inline">
            步骤 JSON（click / clickPoint / waitFor / wait / verify）
          </label>
          <textarea
            className="json"
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            spellCheck={false}
          />
          <label className="inline">
            <input type="checkbox" checked={seqLoop} onChange={(e) => setSeqLoop(e.target.checked)} />
            循环执行整段序列（轮数取上方"最大动作数"）
          </label>
        </>
      )}

      <div className="row">
        <label className="inline" style={{ flex: 1 }}>
          间隔 {interval}ms
          <input
            type="range"
            min={500}
            max={6000}
            step={100}
            value={interval}
            style={{ flex: 1 }}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="row">
        <label className="inline" style={{ flex: 1 }}>
          置信度 {confidence.toFixed(2)}
          <input
            type="range"
            min={0.1}
            max={0.9}
            step={0.05}
            value={confidence}
            style={{ flex: 1 }}
            onChange={(e) => setConfidence(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="row">
        <label className="inline">
          最大动作数
          <input
            type="number"
            style={{ width: 80 }}
            value={maxLoops}
            min={1}
            onChange={(e) => setMaxLoops(Number(e.target.value))}
          />
        </label>
        <label className="inline">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          dryRun（只记录不点击）
        </label>
      </div>

      {error && <p className="hint" style={{ color: '#ff8587' }}>{error}</p>}

      <div className="card">
        <div className="kv">
          <span>状态</span>
          <b style={{ color: task.running ? '#7fe8a6' : undefined }}>
            {task.running ? '运行中' : '空闲'}
          </b>
        </div>
        <div className="kv">
          <span>已执行动作 / 感知轮次</span>
          <b>
            {task.loopCount} / {task.tickCount}
          </b>
        </div>
        <div className="kv">
          <span>最近动作</span>
          <b style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.lastAction}</b>
        </div>
      </div>

      <div className="row">
        {!task.running ? (
          <button className="primary" onClick={() => void start()}>
            ▶ 启动任务{dryRun ? '（dryRun）' : ''}
          </button>
        ) : (
          <button className="danger" onClick={() => void api.stopTask()}>
            ■ 停止 / Esc 急停
          </button>
        )}
      </div>
    </div>
  )
}
