/**
 * 控制面板 preload：仅暴露最小化的 invoke/on 桥。
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('seer', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
  on: (channel: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})
