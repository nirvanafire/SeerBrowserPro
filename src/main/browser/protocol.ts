/**
 * seer:// 内部协议：
 * - seer://start            起始页（功能导航 + 测试入口）
 * - seer://fixture/xxx      内置 Canvas 游戏测试夹具
 * 必须在 app ready 前注册 scheme 特权。
 */
import { app, protocol } from 'electron'
import { join, extname, normalize } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

export function registerSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'seer',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function resourcesDir(): string {
  const dev = join(app.getAppPath(), 'resources')
  if (existsSync(dev)) return dev
  return join(process.resourcesPath, 'resources')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const START_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>SeerBrowserPro 起始页</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #0f1420; color: #e6ecf5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { width: 560px; background: #171f2e; border: 1px solid #26324a; border-radius: 14px; padding: 34px 38px; }
  h1 { font-size: 24px; margin-bottom: 6px; }
  .sub { color: #8a99b5; font-size: 13px; margin-bottom: 24px; line-height: 1.7; }
  a.entry { display: block; padding: 16px 18px; background: #1d2940; border: 1px solid #2c3c5c; border-radius: 10px; color: #7db4ff; text-decoration: none; margin-bottom: 12px; font-size: 15px; }
  a.entry:hover { background: #243350; border-color: #3d5680; }
  ol { margin: 8px 0 0 20px; color: #a9b8d4; font-size: 13px; line-height: 2; }
  .tag { display:inline-block; background:#22344f; color:#7db4ff; border-radius:4px; padding:0 7px; font-size:11px; margin-left:8px; }
</style>
</head>
<body>
  <div class="card">
    <h1>SeerBrowserPro <span class="tag">YOLO26</span></h1>
    <div class="sub">Canvas 网页游戏自动化浏览器。在左侧依次完成：画布探测 → 模型导入 → 检测识别 → 模块缓存 → 自动任务。</div>
    <a class="entry" href="seer://fixture/game-demo.html">▶ 打开内置 Canvas 模拟游戏测试页（推荐先跑通全流程）</a>
    <div class="sub" style="margin-top:18px">首次使用步骤：</div>
    <ol>
      <li>在地址栏输入任意 Canvas 网页游戏地址，或打开上方测试页</li>
      <li>「画布」面板点击自动探测，选中游戏 Canvas</li>
      <li>「模型」面板生成离线演示模型，或导入自定义 YOLO26 ONNX</li>
      <li>「检测」面板单次推理查看识别框，满意后在「任务」面板配置自动点击</li>
    </ol>
  </div>
</body>
</html>`

export function registerProtocol(): void {
  protocol.handle('seer', (request) => {
    const url = new URL(request.url)
    try {
      if (url.hostname === 'fixture') {
        const filePath = normalize(join(resourcesDir(), 'fixtures', url.pathname))
        if (!filePath.startsWith(resourcesDir()) || !existsSync(filePath)) {
          return new Response('Not found', { status: 404 })
        }
        const body = readFileSync(filePath)
        return new Response(new Uint8Array(body), {
          headers: { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' }
        })
      }
      return new Response(START_HTML, { headers: { 'content-type': MIME['.html'] } })
    } catch (e) {
      return new Response(`Internal error: ${String(e)}`, { status: 500 })
    }
  })
}
