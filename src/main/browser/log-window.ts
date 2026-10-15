/**
 * 悬浮日志窗口：无边框置顶小窗（跟随主窗），测试功能时直观查看日志输出。
 * 与主窗共用同一渲染入口（hash='#logs'），通过 EventBus attach/detach
 * 接收与主窗相同的 EvtLog 推送；打开前的历史日志由窗口自行 listLogs 拉取。
 */
import { BrowserWindow } from 'electron'
import { join } from 'node:path'

let logWin: BrowserWindow | null = null

export interface LogWindowHooks {
  onAttach: (w: BrowserWindow) => void
  onDetach: (w: BrowserWindow) => void
}

export function isLogWindowOpen(): boolean {
  return logWin !== null && !logWin.isDestroyed()
}

/** 切换悬浮日志窗口：已开则关闭，未开则创建。返回切换后是否处于打开状态 */
export function toggleLogWindow(parent: BrowserWindow, hooks: LogWindowHooks): boolean {
  if (isLogWindowOpen()) {
    logWin?.close()
    return false
  }
  logWin = new BrowserWindow({
    width: 480,
    height: 340,
    minWidth: 320,
    minHeight: 220,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent,
    show: false,
    backgroundColor: '#0b101b',
    title: '悬浮日志 - SeerBrowserPro',
    webPreferences: {
      // electron-vite 将主进程打包为单个 out/main/index.js，__dirname 即 out/main
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  logWin.setAlwaysOnTop(true, 'floating')
  logWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void logWin.loadURL(rendererUrl + '#logs')
  } else {
    void logWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'logs' })
  }

  hooks.onAttach(logWin)
  logWin.once('ready-to-show', () => {
    // 不抢焦点：避免打断正在进行的游戏操作
    logWin?.showInactive()
  })
  logWin.on('closed', () => {
    if (logWin) hooks.onDetach(logWin)
    logWin = null
  })
  return true
}
