# 微光托业重设计：第二轮工程 / 无障碍原型审查

日期：2026-10-13。审查对象：`prototype/index.html`、`design.css`、`design.js` 和 `DESIGN-SPEC.md` v0.9。范围：独立只读源码 + 静态截图审查；没有操控共享浏览器 / 服务器，没有生产 API、存储、麦克风或真机测试。

## 审查结论

方案在信息层级、四主题结构、默认主题无游戏元素和账号 / 数据边界上已明显收敛；可以作为实施讨论的基础。**本轮为有条件通过设计方向，尚不批准将原型代码直接移入生产。** 需要先修下面的代表稿 / 语义缺口，并将所有专注会话导航纳入保存退出保护。原型的 fixture、固定计时、即时切换失败态均只证明画面可呈现，不证明真实保存、同步、输入法或媒体可用。

已实际用 `view_image` 检视 6 张：`desktop-search-day.jpg`、`mobile-search-results-day.jpg`、`four-theme-home.jpg`、`mobile-home-day.jpg`、`desktop-exam-silk.jpg`、`desktop-settings-day.jpg`。审查时手机详情 / 长释义 / 失败状态仍在补稿，未以桌面代码替代手机截图验收。

## 已采纳且可接受的具体改进

- 日间暖中性、夜间中性炭灰，共用内容面与明确主操作；截图中输入边界和正文可辨。游戏主题题面没有背景纹样或粒子。
- 查词桌面结果 / 详情同屏，手机结果页没有底栏；通用词典与场景词界限、无离线发音说明、来源和不自动新增学习记录均明确。真实例句未生成时不冒充完整内容。
- 来源正文已经从初值 12 px 提升到 13 px，输入 / 筛选边界使用 control token，非信息分割线保留低对比 divider。
- `compositionstart/end`、`e.isComposing` 与 Enter 抑制已在原型说明交互中体现。详情返回保留内存 query 和 `window.scrollY`。这只是演示层基础，真实中文输入法和 ArkWeb 尚未验证。
- 保存答案、学习时间打卡、账号同步与考试记录仅本机的区分进入规格；退出文案没有谎称常规题组持久断点恢复。
- 规格 7.3 将持久化 ID 复用为 `paper→day`、`crystal→night`、`hollow`、`silk`，避免未经服务端支持写入新枚举；theme-only 更新和旧用户明确选择保留。
- 持续装饰为静态，小幅交互支持 `prefers-reduced-motion`；原型没有外部字体、网络接口或真实数据写入。

## 必须修订的代表稿与交互语义

以下依据审查时源码 / 图片。根代理后续修订后应在本文件追加复核记录，不用删除发现历史。

| 优先级 | 发现与证据 | 具体修订 |
|---|---|---|
| P1 · 实施保护 | `desktop-exam-silk.jpg` 的全局侧栏与设置仍可操作；`design.js:39` 通用 `data-page` 直接 navigate。`.focus-mode .sidebar` 的 pointer-events 只在 max700 规则内（该宽侧栏本就隐藏） | 专注页桌面隐藏 / inert 全局导航和设置，或所有导航统一调用当前练习 / 口语 / 模考 leave guard。原型不造成真实丢失，但不能照搬绕过 `MockExam.leave` 的结构 |
| P1 · 代表稿 | `four-theme-home.jpg` 的游戏两卡 SVG 被放大到几百像素，“空洞骑士 / 丝之歌”标题挤成竖排，两组卡高度相差明显；`compareContent` 的普通 `.row` 没有约束 motif | 对照卡标题容器中 motif 固定约 56×56 px，`flex:0 0 56px`；小标题不能受 SVG 挤压。重拍同布局四主题图，不用巨型艺术来证明主题一致 |
| P1 · 查询状态 | `design.js:17` 的输入 value 用 `['initial','input','loading'].includes(state)?'':…`，加载画面清空可见查询，虽提示“输入保留” | loading 继续显示 query；输入中按示例组合字符串展示；异步失败 / 重试 / 慢加载始终保留正在查的词，不把状态切换当清空 |
| P1 · 可辨状态 | `.toggle[aria-checked=false]` 以 divider `--line` 作轨道，thumb 仍 `--on-accent`，状态识别信息过弱；实际比值见下表 | off 轨道用 surface2 + control 边界，thumb 用足够对比的颜色；可显示开 / 关文本。外部命中区仍至少 44 px，而轨道视觉可 32 px |
| P2 · 焦点 | 原型 `render` 全量替换 `#content.innerHTML`；选择选项 / 主题后焦点丢失。Modal 有初始焦点、Tab 环，但 Escape / 取消 remove 后不归还触发控件 | 动态局部更新或按稳定 action key 恢复焦点；modal 关闭返回触发处，背景 inert；详情返回恢复对应结果按钮与列表位置。真实 React 实现应沿用成熟 Dialog / focus 管理 |
| P2 · 状态播报 | `.result-label` 无 role/status；handleInput 的无结果分支无 status；加入按钮无 `aria-pressed` 或持久状态关联；成功仅 toast，已有词仍执行 add | 结果摘要 polite status，不逐字 alert；收藏按钮有 pressed 和可读状态；失败关联说明；已有取消收藏能力须从详情 / 生词本可达，不以“已加入”按钮无限重复写事件 |
| P2 · 选择语义 | 范围按钮 aria-pressed 可用；主题卡实际是 aria-pressed，规格却要求 radio | 二者择一统一：可继续按 pressed button group 规范，或补 radiogroup、radio checked 和方向键操作。不要只补 role 而缺键盘行为 |
| P2 · 命中区 | 手机 `.topbar .iconbtn{width:40px}`、`.taskrow .arrow{min-width:28px}`，toggle 本体高32 px | 用 44×44 px 包围视觉图标 / 开关，并保留间距；这是项目 44 px 目标差距，不能误报为 WCAG 24 px 最低值失败 |
| P2 · 阅读布局 | `.results` / `.detail` 没有独立正文滚动约束；规格承诺桌面双栏独立滚动，长释义会扩展整页 | 明确采用独立列滚动或整页滚动；若独立，提供稳定列高、正确焦点自动可见、position snapshot；不能留下与截图实现相反的规格 |
| P2 · 必要字体 | 手机 settingrow 说明、theme-card 说明仍为 11–12 px，部分信息包括预算 / 保存边界；规格必要辅助字体目标13–14 px | 品牌和评审工具条可例外，正式功能 / 来源 / 数据边界文字至少13–14 px；不能靠灰小字保持卡片高度 |

规格已覆盖 loading / no-result / add-error 等状态，这一轮要求实际呈现不背离规范，不要求给演示原型接真实接口。应继续让全部未实现操作明确说明“演示”，避免通过 toast 声称功能已完成。

## 实际 CSS 颜色核验

从 `design.css` 前四套实际不透明 token 提取，按 sRGB 相对亮度 / WCAG 对比度公式计算，使用未舍入数值作判定。下面保留三位数便于阅读；不是截图像素估计，也不是全页状态 / hover / disabled / 设备合规证明。

| 组合 | day | night | hollow | silk | 结论 |
|---|---:|---:|---:|---:|---|
| text / surface | 15.129 | 13.391 | 13.516 | 13.179 | 普通正文 ≥4.5，通过 |
| muted / surface2 | 4.947 | 6.263 | 6.557 | 6.374 | 元信息 ≥4.5，通过 |
| muted / soft | 4.861 | 5.288 | 5.233 | 5.536 | 选中底色元信息 ≥4.5，通过 |
| on-accent / accent | 9.370 | 8.480 | 8.490 | 7.022 | 主按钮文字 ≥4.5，通过 |
| control / surface2 | 3.228 | 3.532 | 3.844 | 3.890 | 主要面输入边界 ≥3，通过 |
| error / soft | 5.172 | 5.651 | 5.508 | 6.567 | 失败状态文字 ≥4.5，通过 |
| line / surface | 1.285 | 1.527 | 1.643 | 1.550 | 纯分割线不承担组件状态，可接受 |
| on-accent / line（off thumb / track） | 1.285 | 1.603 | 1.676 | 1.656 | 不能把这一低比值作为开关状态识别的唯一线索，需修 |

普通文字阈值依据 [W3C SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)，组件识别 / 状态依据 [W3C SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。divider 与 control 分离正确；并非所有卡片描边都必须达到3:1。目标尺寸须分清 [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) 的24 px及例外，与本项目44–48 px体验门槛。

## 进入生产时真正需要的界面改造

这些是 UI 状态与现有接口适配，不能将原型虚构的“查询/加入/保存”行为理解为 API 已做好，也不应顺势扩展认证 / 算法：

1. **视图外壳与返回。** 将查询上下文放到不随页面挂卸载的 owner-scoped UI state：query、mode、category、filter、display limit、selected word、结果 position、来源页。浏览器 history 与 Native Back 按层返回；先关闭软键盘 / 详情 / 弹层，再返回原入口。不能所有返回都跳首页。原型只有 replaceState 和内存 window scroll，尚无 popstate / Native bridge / 来源页栈。
2. **现有词典管道。** 沿用 loader 的字节 / SHA / count 校验、模型排序和词条 ID。首次通用查词才触发大字典或读取历史通用生词；场景词可先用。真实查询的次级义 / 词形 / 多词 AND 不能被四个 fixture 的 includes 替代。保持原来分批显示数量、收藏 / 到期筛选、解除收藏和词库备份。
3. **写入与同步状态。** add / review / onAttempt 的 boolean 结果决定 UI成功；错误保留选择，不提前增加计数、不自动跳卡。local saved 与 cloud ack 分开；题包云库与考试记录本机分开；账号切换取消旧请求和旧详情。无 schema 扩展或新增假短信认证。
4. **全部离开动作。** 常规练习确认未提交选择，已提交答案沿原 onAttempt 保存；完组时间沿现有打卡。模考所有导航 / 设置 / Back / background 沿现有 FIFO save + interrupted / revision / deadline。口语所有关闭 / Back 服从录音保存与权限生命周期。新全页结构不能拆掉这些 guard。
5. **语义组件。** 用既有 React Dialog、RadioGroup、Select 等构造完整键盘 / 焦点行为；题目选择应互斥而非普通多选 pressed button。搜索结果若采用按钮列表，保留简单 Tab / Enter；若改 listbox 则完整方向键 / selection规范。用 lang=en 标识词头 / IPA / 示例 / 题面，来源用真实可访问链接。
6. **共享 ArkWeb。** viewport/safe area、软键盘高度、折叠宽度、长详情滚动和 Native Back 在共享 CSS 上实现并真机验证；不要以 Chromium headless 390截图替代鸿蒙中文输入法 / 大字 / 权限 / 音频测试。
7. **主题适配。** 前台 day/night token 别名不进入存储枚举；only-theme 保存且不 remount 当前题 / 字典索引 / 录音。留存已有关闭动效的选择。资产 / 图表 / disabled / focus / warning 四主题同矩阵验证。

目前不要求改后端数据格式。必要生产验证重点是「首答 / 复练 / 时间口径」「退出保存失败不跳页」「账号切换不串词条 / 队列」「旧 theme/profile 不重置」「本机题包 / 云库 / 考试状态准确」以及真实键盘 / IME / 屏幕阅读 / 折叠设备。

## 复核门槛与未验项

修订后至少补查：手机详情返回、长词 / 8条长释义、搜索 loading / retry / add-failure，桌面 / 手机练习退出、模考退出失败，四主题比较，主题 off switch，320宽和200%文字放大。收敛后的 screenshot 文件应与当前 CSS/JS 版本同步。

本轮未检查真实账号、学习数据、题包导入、网络慢速、字典解析性能、辅助技术读序、设备放大、软键盘或鸿蒙硬件。规格中的 p95≤150ms、CLS≤0.05等仍是待测预算。本轮没有启动 / 停止进程、操控共享浏览器或修改生产文件；只创建本独立审查文档。
