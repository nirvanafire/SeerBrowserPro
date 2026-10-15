/**
 * 多标签浏览器内核：每个标签一个 WebContentsView（Electron 30+ 推荐 API），
 * 活动标签作为子视图挂到主窗 contentView，非活动标签摘除但保留 WebContents。
 */
import { BrowserWindow, WebContentsView } from 'electron'
import { CHROME_UA, CHROME_UA_METADATA } from './user-agent'
import { randomUUID } from 'node:crypto'
import type { TabInfo } from '@shared/types'
import { computeWebBounds, TOP_BAR_HEIGHT, TOP_BAR_HEIGHT_NO_TABS, type ContentBounds } from './layout'
import { PAGE_HOOK_SOURCE } from './page-hook-source'

const START_URL = 'seer://start'

export interface Tab {
  id: string
  view: WebContentsView
  info: TabInfo
}

export class TabManager {
  private win: BrowserWindow
  private tabs = new Map<string, Tab>()
  private order: string[] = []
  private activeId: string | null = null
  /** 紧急停止回调（Escape） */
  onEmergencyStop: (() => void) | null = null
  /** 标签列表变化回调 */
  onChange: (() => void) | null = null
  /** 活动标签导航完成回调（用于自动匹配缓存） */
  onTabNavigated: ((tabId: string, url: string) => void) | null = null
  /** 标签关闭回调（清理探测缓存 / 选区等每标签状态） */
  onTabClosed: ((tabId: string) => void) | null = null
  /** 顶栏高度（标签栏显隐时由渲染层通过 IPC 调整，网页视图随之布局） */
  private topBarHeight = TOP_BAR_HEIGHT

  constructor(win: BrowserWindow, isDev: boolean) {
    this.win = win
    void isDev
    win.on('resize', () => this.layout())
  }

  createTab(url: string = START_URL): Tab {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })
    // 在首次 loadURL 前伪装 UA：覆盖首个导航的 HTTP 请求头与 navigator.userAgent，
    // 规避站点"浏览器不兼容，请使用最新 Chrome"的 UA 嗅探拦截
    view.webContents.setUserAgent(CHROME_UA)
    const id = randomUUID().slice(0, 8)
    const tab: Tab = {
      id,
      view,
      info: {
        id,
        title: '新标签页',
        url,
        loading: true,
        canGoBack: false,
        canGoForward: false
      }
    }
    this.tabs.set(id, tab)
    this.order.push(id)
    this.bindEvents(tab)
    this.installPageHook(view.webContents)
    // attach 不阻塞首次加载；getContext 钩子在渲染器就绪后注册，
    // 对起始页之后的所有导航（游戏页）生效
    view.webContents.loadURL(url).catch(() => {
      // 非法 URL 时回退起始页
      void view.webContents.loadURL(START_URL)
    })
    this.activate(id)
    return tab
  }

  /**
   * 通过 CDP 在主世界注入 getContext 包装脚本（早于任何页面脚本、无视 CSP）。
   * attach 可在导航前完成，但 Page.enable 在全新 WebContents 的渲染器就绪前
   * 会挂起，因此命令延迟到首次 did-start-loading 后发送。
   * 附加失败（如 DevTools 已占用调试器）时静默：Canvas 探针仍有 getContext 回退探测。
   */
  private installPageHook(wc: Electron.WebContents): void {
    if (wc.debugger.isAttached()) return
    try {
      wc.debugger.attach('1.3')
    } catch (e) {
      console.warn('[page-hook] 调试器附加失败，将使用 getContext 回退探测:', String(e))
      return
    }
    wc.debugger.on('detach', (_e, reason) => {
      console.log('[page-hook] debugger detached:', reason)
    })
    let scheduled = false
    const setup = async (): Promise<void> => {
      if (scheduled) return
      scheduled = true
      try {
        await wc.debugger.sendCommand('Page.enable')
        await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: PAGE_HOOK_SOURCE
        })
      } catch (e) {
        console.warn('[page-hook] 脚本注入失败，将使用 getContext 回退探测:', String(e))
      }
      // Client Hints 覆盖：让 navigator.userAgentData 也报告为 Google Chrome。
      // 独立于 page-hook 失败路径（setUserAgent 已覆盖 UA 字符串，此处仅增强元数据）。
      try {
        await wc.debugger.sendCommand('Network.enable')
        await wc.debugger.sendCommand('Network.setUserAgentOverride', {
          userAgent: CHROME_UA,
          userAgentMetadata: CHROME_UA_METADATA
        })
      } catch (e) {
        console.warn('[ua] Client Hints 覆盖失败（UA 字符串仍有效）:', String(e))
      }
    }
    wc.on('did-start-loading', () => {
      void setup()
    })
    // 极端情况下事件已过，立即补一次
    if (wc.isLoading()) void setup()
  }

  private bindEvents(tab: Tab): void {
    const wc = tab.view.webContents
    wc.on('preload-error', (_e, preloadPath, error) => {
      console.error('[preload-error]', preloadPath, error)
    })
    const updateNav = (): void => {
      tab.info.canGoBack = wc.navigationHistory.canGoBack()
      tab.info.canGoForward = wc.navigationHistory.canGoForward()
      this.emitChange()
    }
    wc.on('page-title-updated', (e, title) => {
      e.preventDefault()
      tab.info.title = title
      this.emitChange()
    })
    wc.on('did-start-loading', () => {
      tab.info.loading = true
      this.emitChange()
    })
    wc.on('did-stop-loading', () => {
      tab.info.loading = false
      tab.info.url = wc.getURL()
      updateNav()
    })
    wc.on('did-navigate', (_e, url) => {
      tab.info.url = url
      updateNav()
      this.onTabNavigated?.(tab.id, url)
    })
    wc.on('did-navigate-in-page', (_e, url) => {
      tab.info.url = url
      updateNav()
    })
    wc.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') {
        this.onEmergencyStop?.()
        event.preventDefault()
      }
    })
    wc.setWindowOpenHandler(({ url }) => {
      // 外链在应用内新标签打开，禁止弹出新窗口
      this.createTab(url)
      return { action: 'deny' }
    })
  }

  activate(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    // 摘除当前活动视图
    if (this.activeId && this.activeId !== id) {
      const old = this.tabs.get(this.activeId)
      if (old) this.win.contentView.removeChildView(old.view)
    }
    this.activeId = id
    this.win.contentView.addChildView(tab.view)
    this.layout()
    this.emitChange()
  }

  close(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.activeId === id) this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    this.tabs.delete(id)
    this.order = this.order.filter((x) => x !== id)
    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[this.order.length - 1]
      if (next) this.activate(next)
    }
    this.onTabClosed?.(id)
    this.emitChange()
  }

  getActive(): Tab | null {
    return this.activeId ? this.tabs.get(this.activeId) ?? null : null
  }

  get(id: string): Tab | null {
    return this.tabs.get(id) ?? null
  }

  list(): TabInfo[] {
    return this.order.map((id) => {
      const t = this.tabs.get(id)!
      return { ...t.info, id: t.id }
    })
  }

  layout(): void {
    const tab = this.getActive()
    if (!tab) return
    const [w, h] = this.win.getContentSize()
    const bounds: ContentBounds = computeWebBounds(w, h, this.topBarHeight)
    tab.view.setBounds(bounds)
  }

  getActiveBounds(): ContentBounds | null {
    if (!this.getActive()) return null
    const [w, h] = this.win.getContentSize()
    return computeWebBounds(w, h, this.topBarHeight)
  }

  /** 调整顶栏高度（隐藏/显示标签栏），并立即重排网页视图 */
  setTopBarHeight(h: number): void {
    const clamped = Math.min(TOP_BAR_HEIGHT, Math.max(TOP_BAR_HEIGHT_NO_TABS, Math.round(h)))
    if (clamped === this.topBarHeight) return
    this.topBarHeight = clamped
    this.layout()
  }

  /** 主窗是否处于可正常截图/交互状态（最小化时跳过连续检测等高耗操作） */
  isMainWinActive(): boolean {
    try {
      return !this.win.isDestroyed() && !this.win.isMinimized()
    } catch {
      return true
    }
  }

  navigate(urlRaw: string): void {
    const tab = this.getActive()
    if (!tab) return
    const url = normalizeUrl(urlRaw)
    tab.info.url = url
    void tab.view.webContents.loadURL(url)
    this.emitChange()
  }

  back(): void {
    const wc = this.getActive()?.view.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(): void {
    const wc = this.getActive()?.view.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(): void {
    this.getActive()?.view.webContents.reload()
  }

  stop(): void {
    this.getActive()?.view.webContents.stop()
  }

  private emitChange(): void {
    this.onChange?.()
  }
}

export function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return START_URL
  if (/^seer:\/\//.test(s) || /^https?:\/\//i.test(s) || /^file:\/\//i.test(s)) return s
  // 域名形态：含点号、无空格
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return `https://${s}`
  // 其余作为搜索
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`
}
