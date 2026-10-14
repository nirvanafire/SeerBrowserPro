/**
 * SeerBrowserPro 主进程入口：窗口、协议、服务装配与生命周期。
 */
import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { registerSchemePrivileged, registerProtocol } from './browser/protocol'
import { TabManager } from './browser/tab-manager'
import { CHROME_UA } from './browser/user-agent'
import { ModelManager } from './vision/model-manager'
import { YoloEngine } from './vision/yolo-engine'
import { DetectService } from './automation/detect-service'
import { TaskRunner } from './automation/task-runner'
import { ModuleStore } from './cache/module-store'
import { DatasetExporter } from './annotate/dataset-export'
import { registerHandlers } from './ipc/handlers'

registerSchemePrivileged()

// 虚拟机 / 远程桌面 / 无独显环境下 GPU 进程会崩溃（Windows 退出码 -36861）。
// 统一回退 SwiftShader 软件渲染：capturePage 截图与 Canvas/WebGL 游戏仍可正常工作。
// 必须在 app ready 之前调用。
app.disableHardwareAcceleration()

// 全局 UA 兜底：默认 UA 含 "Electron/x.y" 与 app 名，会触发站点的
// "浏览器不兼容，请使用最新 Chrome" 拦截；统一伪装为标准 Chrome。
// 标签页另有 webContents.setUserAgent + CDP Client Hints 覆盖（见 tab-manager）。
app.userAgentFallback = CHROME_UA

// 开发态把 userData 放到工程内（.userdata），避免受企业/沙箱对 %APPDATA% 的写入限制，
// 同时让开发期的模型/缓存/数据集与正式安装版互不污染；打包后仍使用系统默认目录。
if (!app.isPackaged) {
  const devUserData = join(app.getAppPath(), '.userdata')
  mkdirSync(devUserData, { recursive: true })
  app.setPath('userData', devUserData)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let win: BrowserWindow | null = null

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0f1420',
    title: 'SeerBrowserPro',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 外部链接（target=_blank 已在标签内处理，这里兜底系统浏览器）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  registerProtocol()

  // ---- 服务装配 ----
  const tabs = new TabManager(win, !app.isPackaged)
  const models = new ModelManager()
  const engine = new YoloEngine()
  const detect = new DetectService(tabs, engine, models)
  const store = new ModuleStore()
  const dataset = new DatasetExporter()
  const runner = new TaskRunner(tabs, detect, store)
  registerHandlers({ win, tabs, models, engine, detect, runner, store, dataset })

  // 开发态自动开 DevTools（仅控制面板）
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    await win.loadURL(rendererUrl)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  tabs.createTab('seer://start')

  win.on('closed', () => {
    win = null
    detect.stopContinuous()
    runner.stop('窗口关闭')
  })
}

if (gotLock) {
  app.whenReady().then(bootstrap).catch((e) => {
    console.error('启动失败', e)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}
