# 微光托业 · 全界面重设计评审包

日期：2026-10-13。状态：**v1.0 内部评审修订稿，等待父会话独立终审**。这是一份设计阶段的归档，不代表应用已经实现、部署、手机安装或全量无障碍验收。

## 从这里审阅

1. [正式设计规格](DESIGN-SPEC.md)：范围、信息架构、全页面布局、搜索状态、四主题、数据边界、实现顺序与验收。
2. [可交互原型](prototype/index.html)：本机独立 HTML/CSS/JS；顶部可选择 15 个页面、四主题和相关状态。所有指标、题文、词义、题包均为演示，不接入真实接口、账号或存储。
3. [四主题同页对照](screenshots/four-theme-home.jpg)：同一内容、同一尺度的日间 / 夜间 / 空洞骑士 / 丝之歌，1440×1500 审阅板。
4. [独立评审记录](reviews/README.md)：保留第一轮、第二轮原始意见和修订复核，不把最初的缺陷记录删成“从未发生”。
5. [验证与限制](QA.md)：区分实际浏览器交互、文件/像素审查与尚未执行的生产、设备验收。

正式归档位置：最新已核实主题 checkout 的 `docs/design/ui-redesign-20261013/`。原始制作目录为 `交付/界面重设计-20261013/`。草稿在 [drafts/DESIGN-SPEC-v0.9.md](drafts/DESIGN-SPEC-v0.9.md)；当前稿不得标为“用户终审通过”。

## 主要方向和取舍

采用安静的学习工作台：系统无衬线、清晰对齐、稳定密度、一处主操作；删除默认主题中的游戏场景与重复缩略图。桌面 224px 侧栏，手机保留今日 / 练习 / 复习 / 进度 / 资料五项底栏；普通页顶部查词一击可达。查词和作答进入专注布局，作答时隐藏全局导航，避免绕过保存保护。

今日任务先回答做什么。演示主任务是 8 个词卡约 5 分钟；3 道题目复练约 3 分钟是另一队列；新题约 10 分钟、新词约 7 分钟按余力选择。两个复习队列不会被一个按钮虚报为一起完成。常规练习只有已提交答案持久保存；模考继续使用原题包、原截止时间及恢复机制。

桌面搜索采用列表与详情并列、整页纵向滚动。手机采用列表→全屏详情，恢复查询、筛选、已显示结果和位置；来源返回另行保存。保留场景词 / 通用词典两个范围；“相关”只表示前缀、词内或释义匹配。当前没有拼写纠错、全库内置发音或新的后端搜索接口。

四主题共享业务状态和组件。默认日夜完全无游戏元素；游戏主题仅在标题边缘、主题预览保留小幅原创纹样，题面/输入区为不透明清晰阅读面。复用 `paper / crystal / hollow / silk` 持久化枚举，只改变其视觉映射；主题更新继续只提交 theme 字段。

## 页面覆盖与关键图片

| 页面 / 状态 | 桌面 | 手机 |
|---|---|---|
| 今日任务 / 首次 / 模考继续 | [今日](screenshots/desktop-home-day.jpg)、[首次](screenshots/desktop-home-empty.jpg) | [今日](screenshots/mobile-home-day.jpg) |
| 查词结果与详情 | [双栏](screenshots/desktop-search-day.jpg) | [结果](screenshots/mobile-search-results-day.jpg)、[详情](screenshots/mobile-search-detail-day.jpg)、[长词长释义](screenshots/mobile-search-long-night.jpg) |
| 搜索异常与收藏筛选 | [状态总览](screenshots/desktop-states-day.jpg) | [加载失败](screenshots/mobile-search-error-day.jpg)、[无结果](screenshots/mobile-search-empty-day.jpg)、[生词为空](screenshots/mobile-search-mine-empty.jpg) |
| 练习入口 / 作答 / 解析 | [练习](screenshots/desktop-practice-night.jpg)、[解析](screenshots/desktop-session-hollow.jpg) | [练习](screenshots/mobile-practice-silk.jpg)、[退出](screenshots/mobile-exit-modal.jpg) |
| 题组完成 / 时间打卡 | [打卡](screenshots/desktop-session-checkin.jpg) | [完组](screenshots/mobile-session-complete.jpg)、[打卡](screenshots/mobile-session-checkin.jpg) |
| 复习 / 词卡失败 / 错题 | [复习](screenshots/desktop-review-night.jpg) | [复习](screenshots/mobile-review-hollow.jpg)、[词卡失败](screenshots/mobile-card-save-error.jpg)、[到期0仍有错题](screenshots/mobile-review-due-zero.jpg) |
| 进度 / 无基线 | [进度](screenshots/desktop-progress-day.jpg) | [进度](screenshots/mobile-progress-night.jpg) |
| 学习资料 / 本机题包 / 私人云库 | [资料](screenshots/desktop-library-day.jpg)、[本机库](screenshots/desktop-local-library-night.jpg) | [资料](screenshots/mobile-library-day.jpg)；原型可切云库/身份/下载失败 |
| 模考预检 / 作答 / 结果 / 解析 | [预检](screenshots/desktop-examsetup-night.jpg)、[作答](screenshots/desktop-exam-silk.jpg)、[结果](screenshots/desktop-examresult-day.jpg)、[原题解析](screenshots/desktop-mock-review.jpg) | 原型同页响应式；退出保存语义见规格 |
| 口语 / 录音 / 权限 | [口语](screenshots/desktop-speaking-day.jpg) | 原型支持录音中 / 权限失败的呈现，不请求麦克风 |
| 四主题选择 / 状态 | [设置](screenshots/desktop-settings-day.jpg)、[四套对照](screenshots/four-theme-home.jpg) | [夜间下的四套预览](screenshots/mobile-settings-night.jpg)、[状态总览](screenshots/mobile-states-day.jpg) |

部分截图为视口取样，长页面以原型及长释义完整稿补足；不得把静态截图当真实计时、持久保存、媒体试听、上传下载或设备返回已验收。

## 正式实现所需的 UI 适配

需要重建共享页面壳与专注页布局，给现有学习组件接入统一的返回/来源/退出控制器；保留 Native Back 的录音→模考→图片→词典→壳优先级。列表快照、请求序号及焦点属于 UI 状态，不做学习数据迁移。延迟通用字典读取并保留 SHA 校验、现有排序与旧收藏 ID；Worker / 分块依据低端设备实测再决定。

主题 tokens 必须覆盖 document/body、模考提前返回分支和 Portal 弹层；主题→素材映射必须消除默认主题的固定 IP 场景，不能只改 paletteName。复用已有提交、收藏、打卡、录音、模考、题包和身份接口；不新增认证、云考试同步、错因标记/计划编辑/学习 JSON 恢复页面。

保存失败时保留当前选择并留页；读取失败不能作为空库覆盖已有快照。架构线记录的快照、IndexedDB abort、同录音 ID 的 R2/D1 风险属于独立整改，不在本轮 UI 改版中擅自迁移、修复或清理真实存储。正式实施前复查最新分支和同目录工作。

## 本机预览

可直接在浏览器打开 `prototype/index.html`；也可在本机用静态服务器运行该目录。原型只读取自己的 CSS/JS，不读取任何私人题包。此轮 QA 的临时服务器已由主代理自行收尾，不占用其他任务。

```powershell
python -m http.server 41873 --bind 127.0.0.1 --directory 'D:\zzl\托业学习\交付\界面重设计-20261013\prototype'
```

父会话完成独立审阅后，记录意见及最终修订，再协调进入实现。已请求的实现授权持续有效，这是阶段协调，不要求用户重复授权。没有 push、merge、发布、上传评审包或手机安装。
