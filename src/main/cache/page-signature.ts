/**
 * 页面签名：用于判断"当前游戏页面"与缓存记录是否同一个页面。
 * 三级证据：origin + pathname（强）、DOM 结构摘要（中）、截图差异哈希（弱）。
 */
import type { WebContents } from 'electron'
import type { RawBitmap } from '../vision/preprocess'
import { fnv1a } from '../vision/coords'

export interface PageIdentity {
  origin: string
  pathPattern: string
  title: string
  domHash: string
}

/** 在页面内采集轻量 DOM 结构摘要（只读，无副作用） */
export async function collectPageIdentity(wc: WebContents): Promise<PageIdentity> {
  const data = (await wc.executeJavaScript(`(() => {
    const counts = ['button','a','img','input','canvas','iframe']
      .map(t => t + ':' + document.getElementsByTagName(t).length).join(',');
    const canvases = Array.from(document.querySelectorAll('canvas'))
      .map(c => c.width + 'x' + c.height).join(',');
    return JSON.stringify({
      href: location.href,
      origin: location.origin,
      path: location.pathname,
      title: document.title,
      counts,
      canvases
    });
  })()`)) as string
  const parsed = JSON.parse(data) as {
    href: string
    origin: string
    path: string
    title: string
    counts: string
    canvases: string
  }
  const pathPattern = simplifyPath(parsed.path)
  const domHash = fnv1a([parsed.title, parsed.canvases, parsed.counts].join('|'))
  return {
    origin: parsed.origin === 'null' ? safeOrigin(parsed.href) : parsed.origin,
    pathPattern,
    title: parsed.title,
    domHash
  }
}

/** 将路径中的长数字/哈希段归一化为 *，提升同模板页面命中率 */
function simplifyPath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg
      if (/^\d{4,}$/.test(seg)) return '*'
      if (/^[a-f0-9]{16,}$/i.test(seg)) return '*'
      return seg
    })
    .join('/')
}

function safeOrigin(href: string): string {
  try {
    return new URL(href).origin
  } catch {
    return 'unknown'
  }
}

export function pageIdOf(identity: Pick<PageIdentity, 'origin' | 'pathPattern'>): string {
  return fnv1a(identity.origin + '|' + identity.pathPattern)
}

/**
 * 差异哈希 dHash：缩放为 9x8 灰度，比较相邻列亮度，输出 64bit（16 位 hex）。
 * 纯 JS 最近邻采样，无需图像库。
 */
export function dHash(bm: RawBitmap): string {
  const W = 9
  const H = 8
  const gray: number[] = new Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(bm.height - 1, Math.floor(((y + 0.5) / H) * bm.height))
    for (let x = 0; x < W; x++) {
      const sx = Math.min(bm.width - 1, Math.floor(((x + 0.5) / W) * bm.width))
      const i = (sy * bm.width + sx) * 4
      gray[y * W + x] =
        0.299 * bm.data[i] + 0.587 * bm.data[i + 1] + 0.114 * bm.data[i + 2]
    }
  }
  let bits = 0n
  let idx = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (gray[y * W + x + 1] > gray[y * W + x]) bits |= 1n << BigInt(idx)
      idx++
    }
  }
  return bits.toString(16).padStart(16, '0')
}

export function hammingDistanceHex(a: string, b: string): number {
  const x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = x
  let count = 0
  while (n) {
    count += Number(n & 1n)
    n >>= 1n
  }
  return count
}
