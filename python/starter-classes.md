# 模拟类游戏 UI 起步标签体系

在 SeerBrowserPro 标注面板中建议统一使用英文小写下划线标签（YOLO 类名规范）。
首批先标 10~20 个高频功能，每类 50+ 张样本即可让 yolo26n 收敛到可用水平。

## 通用导航
| 标签 | 含义 |
|---|---|
| `start_button` | 开始/启动游戏 |
| `close_button` | 关闭弹窗（X） |
| `confirm_button` | 确认 / OK / 领取 |
| `cancel_button` | 取消 |
| `back_button` | 返回 |
| `settings_button` | 设置齿轮 |

## 资源与经营
| 标签 | 含义 |
|---|---|
| `resource_icon` | 金币/钻石/体力等资源入口 |
| `building` | 可交互建筑 |
| `production_bubble` | 建筑产出气泡（收取） |
| `upgrade_button` | 升级 |
| `speedup_button` | 加速（沙漏） |

## 角色与战斗
| 标签 | 含义 |
|---|---|
| `character` | 我方角色/NPC |
| `enemy` | 怪物/敌对目标 |
| `skill_button` | 技能按钮 |
| `attack_button` | 攻击/出征 |
| `hp_bar` | 血条（状态判断用，不点击） |

## 弹窗与流程
| 标签 | 含义 |
|---|---|
| `dialog` | 对话框/弹窗容器（流程节点判断） |
| `reward_dialog` | 奖励结算弹窗 |
| `ad_button` | 看广告奖励（一般配置为不点击） |
| `red_dot` | 红点提醒（任务引导用） |

## 标注建议
1. 同类按钮在不同页面样式差异大时，先按功能命名（`close_button`），不按外观命名。
2. 只标"可操作/需要判断状态"的元素；纯装饰不标。
3. 遮挡、半透明、出框超过 70% 的样本不标或标"困难样本"（可后续加 ignore 类）。
4. 每个标签覆盖多分辨率/多主题，训练前在应用内把窗口拖到不同大小各采一批。
