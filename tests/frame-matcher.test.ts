import { describe, it, expect } from 'vitest'
import { matchChildFrameIndex } from '../src/main/probe/frame-matcher'

describe('matchChildFrameIndex', () => {
  it('按 URL 精确匹配', () => {
    const children = [
      { url: 'https://a.com/x', name: '' },
      { url: 'https://b.com/game', name: '' }
    ]
    expect(matchChildFrameIndex(children, { src: 'https://b.com/game', name: '' }, new Set())).toBe(1)
  })

  it('同 URL 多实例按顺序分配（taken 排除）', () => {
    const children = [
      { url: 'https://a.com/ad', name: '' },
      { url: 'https://a.com/ad', name: '' }
    ]
    const taken = new Set<number>()
    const first = matchChildFrameIndex(children, { src: 'https://a.com/ad', name: '' }, taken)
    expect(first).toBe(0)
    taken.add(first)
    expect(matchChildFrameIndex(children, { src: 'https://a.com/ad', name: '' }, taken)).toBe(1)
  })

  it('URL 不一致时按 name 兜底', () => {
    const children = [{ url: 'https://cdn.com/redirected', name: 'game-frame' }]
    expect(
      matchChildFrameIndex(children, { src: 'https://a.com/game', name: 'game-frame' }, new Set())
    ).toBe(0)
  })

  it('about:blank / srcdoc iframe 匹配空白 frame', () => {
    const children = [
      { url: 'https://a.com/x', name: '' },
      { url: 'about:blank', name: '' },
      { url: 'about:srcdoc', name: '' }
    ]
    expect(matchChildFrameIndex(children, { src: '', name: '' }, new Set())).toBe(1)
    expect(matchChildFrameIndex(children, { src: 'about:blank', name: '' }, new Set([1]))).toBe(2)
  })

  it('无法匹配返回 -1', () => {
    const children = [{ url: 'https://a.com/x', name: 'f1' }]
    expect(matchChildFrameIndex(children, { src: 'https://b.com/y', name: 'f2' }, new Set())).toBe(-1)
  })
})
