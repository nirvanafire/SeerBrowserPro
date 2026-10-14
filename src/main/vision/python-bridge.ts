/**
 * Python 工具桥：调用 python/ 目录下的脚本，完成 Node 侧无法实现的能力：
 * - make_dummy_model.py：仅依赖轻量 onnx 包，生成离线演示模型（验证完整推理链路）
 * - fetch_official.py：pip 安装 ultralytics，下载 yolo26n.pt 并导出 nms=False 的 ONNX
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import { existsSync } from 'node:fs'

export interface PythonRunResult {
  code: number
  stdout: string
}

function resolvePythonDir(): string {
  // 开发态：<project>/python；打包态：resources/python
  const dev = join(app.getAppPath(), 'python')
  if (existsSync(dev)) return dev
  return join(process.resourcesPath, 'python')
}

/** 优先 python（本机 3.11，ML wheel 最全），其次 py 启动器 */
function pythonCommands(): string[] {
  return ['python', 'py']
}

/**
 * 运行 Python 脚本，实时回调 stdout/stderr。
 */
export async function runPython(
  script: string,
  args: string[],
  onLog: (line: string) => void
): Promise<PythonRunResult> {
  const dir = resolvePythonDir()
  const scriptPath = join(dir, script)
  const commands = pythonCommands()

  let lastError = ''
  for (const cmd of commands) {
    try {
      return await new Promise<PythonRunResult>((resolve, reject) => {
        const child = spawn(cmd, [scriptPath, ...args], { cwd: dir })
        let stdout = ''
        child.stdout.on('data', (d: Buffer) => {
          const text = d.toString()
          stdout += text
          text.split(/\r?\n/).filter(Boolean).forEach((l) => onLog(l))
        })
        child.stderr.on('data', (d: Buffer) => {
          const text = d.toString()
          stdout += text
          text.split(/\r?\n/).filter(Boolean).forEach((l) => onLog(l))
        })
        child.on('error', (err) => {
          lastError = String(err)
          reject(err)
        })
        child.on('close', (code) => {
          resolve({ code: code ?? -1, stdout })
        })
      })
    } catch (e) {
      lastError = String(e)
      onLog(`命令 ${cmd} 不可用：${e instanceof Error ? e.message : e}`)
    }
  }
  throw new Error(`未找到可用的 Python 解释器（尝试了 ${commands.join(', ')}）：${lastError}`)
}
