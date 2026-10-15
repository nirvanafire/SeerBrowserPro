import type { JSX } from 'react'
import { useStore } from '../store'
import { api } from '../api'

/** 使用说明面板：首次启动自动打开，之后可随时从「帮助」进入 */
export function HelpPanel(): JSX.Element {
  const setPanel = useStore((s) => s.setPanel)

  const goto = (p: Parameters<typeof setPanel>[0]) => () => setPanel(p)

  return (
    <div className="panel">
      <h3>SeerBrowserPro 使用说明</h3>
      <p className="hint">
        面向 Canvas 网页游戏的自动化浏览器：自动发现游戏画布（含 iframe 内）、识别页面功能点、
        缓存后驱动自动点击。按下面 4 步即可跑通。
      </p>

      <div className="card">
        <div className="section-title">快速上手</div>
        <ol className="help-steps">
          <li>
            <b>打开游戏页面</b>：顶部地址栏输入网址回车。页面加载后会
            <b>自动探测</b>全部 Canvas（画布在 iframe 里也能找到），并在日志中提示已选用的画布。
          </li>
          <li>
            <b>确认画布</b>：左侧「画布」面板查看探测结果，带「最可能是游戏画布」标记的即自动选中项；
            也可手动选用或输入 CSS 选择器。
          </li>
          <li>
            <b>识别功能点</b>：到「检测」面板
            <button className="tiny" onClick={goto('detect')}>前往</button>
            —— 没有模型时点「智能找功能」用画面变化发现动态功能；有模型时用「单次推理 / 连续检测」。
            对识别出的目标点「存为功能点」完成缓存。
          </li>
          <li>
            <b>自动化</b>：「任务」面板把功能点编排成循环任务自动执行；随时按 <b>Esc</b> 急停。
          </li>
        </ol>
      </div>

      <div className="card">
        <div className="section-title">各面板速查</div>
        <div className="kv"><span>画布</span><b>探测/选用游戏画布，iframe 内画布自动支持</b></div>
        <div className="kv"><span>检测</span><b>智能找功能（无需模型）/ YOLO 推理 / 功能点匹配</b></div>
        <div className="kv"><span>模型</span><b>导入 YOLO26 ONNX、调阈值、生成演示模型</b></div>
        <div className="kv"><span>缓存</span><b>管理已缓存的功能点（可锁定/删除/改动作）</b></div>
        <div className="kv"><span>任务</span><b>循环点击 / 步骤序列两种自动化模式</b></div>
        <div className="kv"><span>标注</span><b>独立大窗口标注工作台，产出训练数据集</b></div>
        <div className="kv"><span>日志</span><b>侧栏日志 + 悬浮日志窗（测试时实时查看）</b></div>
      </div>

      <div className="card">
        <div className="section-title">常见问题</div>
        <p className="hint">
          · <b>没有训练模型能用吗？</b>能。「检测」面板的「智能找功能」基于双帧画面变化分析，
          无需模型即可发现按钮动画、弹窗等动态功能并缓存。
        </p>
        <p className="hint">
          · <b>游戏在 iframe 里？</b>自动探测会遍历整棵 frame 树（含跨源 iframe），
          坐标已换算到顶层视口，检测与点击无需额外配置。
        </p>
        <p className="hint">
          · <b>识别不到功能？</b>先点一次「智能找功能」或「单次推理」，把目标「存为功能点」；
          之后的检测会自动把画面目标与缓存功能点匹配。
        </p>
        <p className="hint">
          · <b>想边测试边看日志？</b>点地址栏右侧 ☰ 打开悬浮日志窗，置顶显示、不抢焦点。
        </p>
        <p className="hint">
          · <b>界面太挤？</b>点 ▥ 可隐藏标签栏（单页模式），网页区域更大；再点恢复。
        </p>
      </div>

      <div className="row">
        <button className="primary" onClick={goto('canvas')}>
          开始使用：去画布探测
        </button>
        <button onClick={() => void api.openUserData()}>打开数据目录</button>
      </div>
    </div>
  )
}
