/**
 * 游戏页面 getContext 钩子的主世界脚本源码。
 *
 * 通过 CDP Page.addScriptToEvaluateOnNewDocument 注入：
 * - 在每个新文档（含导航、iframe）的页面脚本执行前，于主世界同步运行
 * - 不受页面 CSP 限制，也不存在 preload 隔离世界改不到主世界原型的问题
 * - 包装 HTMLCanvasElement.prototype.getContext，在元素上记录
 *   data-seer-ctx（2d/webgl/webgl2/webgpu），供 Canvas 探针直接读取
 */
export const PAGE_HOOK_SOURCE = `(function () {
  if (window.__seerHookInstalled) return;
  window.__seerHookInstalled = true;
  try {
    var orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      try {
        if (type && this.setAttribute) {
          var t = String(type).toLowerCase();
          if (t === 'experimental-webgl') t = 'webgl';
          if (t === '2d' || t === 'webgl' || t === 'webgl2' || t === 'webgpu') {
            this.setAttribute('data-seer-ctx', t);
          }
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  } catch (e) {}
})();`
