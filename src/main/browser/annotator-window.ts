/**
 * 标注工作台窗口：独立大窗口承载 Annotator（同一渲染入口，hash='#annotator'）。
 * 抓帧/保存走与主窗相同的 IPC（captureFrame 始终抓主窗活动标签的游戏画面）。
 */
import { BrowserWindow } from 'electron'
import { join } from 'node:path'

let annotatorWin: BrowserWindow | null = null

export function openAnnotatorWindow(parent: BrowserWindow): void {
  if (annotatorWin && !annotatorWin.isDestroyed()) {
    annotatorWin.focus()
    return
  }
  annotatorWin = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1420',
    title: '标注工作台 - SeerBrowserPro',
    autoHideMenuBar: true,
    webPreferences: {
      // electron-vite 将主进程打包为单个 out/main/index.js，__dirname 即 out/main
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  annotatorWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void annotatorWin.loadURL(rendererUrl + '#annotator')
  } else {
    void annotatorWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'annotator' })
  }

  annotatorWin.on('closed', () => {
    annotatorWin = null
    if (!parent.isDestroyed()) parent.focus()
  })
}
