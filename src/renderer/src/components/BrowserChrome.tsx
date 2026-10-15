import type { JSX } from 'react'
import { useStore } from '../store'
import { api } from '../api'

export function BrowserChrome(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const urlDraft = useStore((s) => s.urlDraft)
  const setUrlDraft = useStore((s) => s.setUrlDraft)
  const tabsHidden = useStore((s) => s.tabsHidden)
  const toggleTabsHidden = useStore((s) => s.toggleTabsHidden)

  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[tabs.length - 1]

  const go = (): void => {
    if (urlDraft.trim()) void api.navigate(urlDraft)
  }

  return (
    <div className={'topbar' + (tabsHidden ? ' no-tabs' : '')}>
      {!tabsHidden && (
        <div className="tabstrip">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={'tab' + (t.id === active?.id ? ' active' : '')}
              onClick={() => void api.activateTab(t.id)}
              title={t.url}
            >
              {t.loading && <span className="dot" />}
              <span className="title">{t.title || '未命名'}</span>
              <button
                className="close"
                onClick={(e) => {
                  e.stopPropagation()
                  void api.closeTab(t.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button className="add" title="新建标签" onClick={() => void api.createTab()}>
            ＋
          </button>
        </div>
      )}
      <div className="navrow">
        <button className="navbtn" title="后退" onClick={() => void api.back()}>
          ←
        </button>
        <button className="navbtn" title="前进" onClick={() => void api.forward()}>
          →
        </button>
        <button
          className="navbtn"
          title={active?.loading ? '停止' : '刷新'}
          onClick={() => (active?.loading ? api.stop() : api.reload())}
        >
          {active?.loading ? '×' : '⟳'}
        </button>
        <input
          className="url"
          value={urlDraft}
          placeholder="输入网址或搜索关键词，回车访问（如 seer://fixture/game-demo.html）"
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
          }}
        />
        <button
          className="navbtn"
          title={tabsHidden ? '显示标签栏' : '隐藏标签栏（单页模式，网页区域更大）'}
          onClick={toggleTabsHidden}
        >
          {tabsHidden ? '▤' : '▥'}
        </button>
        <button
          className="navbtn"
          title="悬浮日志（置顶小窗，测试时实时查看输出）"
          onClick={() => void api.toggleLogWindow()}
        >
          ☰
        </button>
      </div>
    </div>
  )
}
