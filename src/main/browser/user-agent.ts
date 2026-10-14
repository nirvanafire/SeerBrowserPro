/**
 * UA 伪装：部分站点用 navigator.userAgent / Client Hints 嗅探浏览器，
 * Electron 默认 UA 带 "Electron/x.y" 与 app 名，会被判定为"不兼容浏览器"
 * 并提示"请使用最新的 Chrome"。这里统一伪装成与嵌入 Chromium 同版本的标准
 * Windows Chrome UA（版本取自 process.versions.chrome，避免虚报能力）。
 */

/** 嵌入 Chromium 的版本，与真实渲染能力保持一致 */
export const CHROME_VERSION: string = process.versions.chrome
export const CHROME_MAJOR: string = CHROME_VERSION.split('.')[0]

/** 标准 Windows x64 Chrome UA（HTTP User-Agent 头 / navigator.userAgent） */
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  `(KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`

/**
 * Client Hints 元数据（navigator.userAgentData）。
 * 仅保留 Chrome 90+ 以来稳定的字段，避免 CDP 对未知字段校验报错。
 */
export const CHROME_UA_METADATA = {
  brands: [
    { brand: 'Not_A Brand', version: '8' },
    { brand: 'Chromium', version: CHROME_MAJOR },
    { brand: 'Google Chrome', version: CHROME_MAJOR }
  ],
  // 高熵值 getHighEntropyValues(["fullVersionList"]) 用的完整版本列表，
  // 缺它时该字段里不会出现 "Google Chrome"
  fullVersionList: [
    { brand: 'Not_A Brand', version: '8.0.0.0' },
    { brand: 'Chromium', version: CHROME_VERSION },
    { brand: 'Google Chrome', version: CHROME_VERSION }
  ],
  fullVersion: CHROME_VERSION,
  platform: 'Windows',
  platformVersion: '15.0.0',
  architecture: 'x86',
  model: '',
  mobile: false,
  bitness: '64',
  wow64: false
}
