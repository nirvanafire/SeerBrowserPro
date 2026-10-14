/// <reference types="vite/client" />

declare global {
  interface Window {
    seer: {
      invoke: (channel: string, payload?: unknown) => Promise<unknown>
      on: (channel: string, callback: (payload: unknown) => void) => () => void
    }
  }
}

export {}
