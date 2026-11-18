# 界面重设计实施：工程合同与验证证据

记录日期：2026-10-13。独立工程审查者：`/root/engineering_review`。

本文件只在 `vocab-work/ui-redesign-implementation-20261013/engineering/` 独立目录交付。只读生产源码；新测试执行真实 TS/TSX 模块，React、UI widget、Native Back、时钟及 I/O 使用私有内存模拟。没有运行浏览器、设备、服务进程、推送、部署、真实学习数据写入或终止其他任务。

**当前结论：练习保存/返回保护及读取状态桥接的 14 条独立行为合同通过；整个重设计尚在集成，不是最终应用验收。** 设计归档中独立终审“暂不通过”的记录保持原样；不能用新增源码、fixture 截图或测试覆盖声明其已复验通过。

## 1. 已核实的现场与验证入口

- 活跃 checkout：`D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site`，分支 `feat/ui-redesign-v11`，HEAD `12317b26b85a71888760b0cc18242d00a843ac74`。这些是本轮读取时的值，不能假定其他 checkout/main 包含工作。
- 按 `AGENTS.md`，只有 root 集成者修改活跃 Site；各模块作者在各自 staging 产出。Git 命令使用单命令 `-c safe.directory=<已核实目录>`，未修改全局配置。
- Node 可执行路径 `C:\Program Files\nodejs\node.exe`；根依赖及测试文件完整。读取时 `tests/*.test.cjs` 实际有 23 个文件（含集成中新文件），并非 PowerShell 表格误读的“一个测试”。
- `package.json` 的 `test:study` 是固定文件枚举，新增回归必须接入该枚举才能被此入口执行。`test` 还包括内容验证、构建与 `*.test.mjs`；不能把运行本文件的局部测试冒充完整流水线。
- 父集成者报告基线 typecheck 通过；本审查者没有独立复跑其当时版本，也没有运行构建或浏览器脚本。等 actualdiffready 后执行最终相关检查。

### 本轮已执行

```powershell
$env:LANTERN_REVIEW_ROOT='D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site'
node --test 'vocab-work\ui-redesign-implementation-20261013\engineering\tests\ui-redesign-practice.test.cjs' 'vocab-work\ui-redesign-implementation-20261013\engineering\tests\ui-redesign-hook-contract.test.cjs'
```

结果：**14/14 通过**。测试复制到正式 `tests/` 后，未设置环境变量时也按现有 repo harness 约定从父目录找源码；staging 执行必须指定 `LANTERN_REVIEW_ROOT`。

在活跃 Site 执行以下现有核心测试：

```powershell
node --test tests/study-invariants.test.cjs tests/study-data-v2.test.cjs tests/theme-persistence.test.cjs tests/theme-atmosphere.test.cjs tests/native-lifecycle.test.cjs
```

结果：**69 条，68 通过、1 失败**。唯一失败是 `native-lifecycle.test.cjs:236` 仍断言 `window.confirm` 调用次数等于 1。新口语采用应用内 Dialog，源码中的保护仍存在；该结果表明旧 harness 与新 UI 不匹配，**不等同于已证明保护失效，也不能当作测试通过**。已交口语作者适配开放确认、取消保留、原 Blob/原 ID 重试的原有行为断言。后续以正式更新后的运行结果替换此状态，保留此初次证据。

## 2. 数据、ID、主题与功能保留合同

| 边界 | 必须保留 | 必要验证 |
|---|---|---|
| 学习 owner | `lantern-v1-<owner 或 device>`；独立 `:profile`、`:op:<id>`、`:ack:<id>`、`:recording:<id>`、`:sync:<kind>:<id>`、`:required-schema` | 切账号不可上传/导出前账号快照；晚到响应无效；未来 schema 保留原字节且拒写 |
| 词库 owner | `lantern-vocab-v1:device:` 或 `lantern-vocab-v1:owner:<encodeURIComponent(owner)>:` | 保留词条/事件 ID、合并导入、收藏不等于复习；不改 key 生成算法 |
| 音频 | IndexedDB `lantern-audio` v1 / `audio`，Blob key=`studyKey+':'+recordingId` | 练习开始时间保留；真实 Blob 才能回放、下载、重试；元数据不代替音频 |
| 模考 | IndexedDB `lantern-private-exams-v1` v3，packages/catalog `[ownerId,key]`，attempts `[ownerId,id]`，key=`examId@version` | 首次/复测、题型版本、原 deadline、CAS revision、事务完成后成功，不重建 ID |
| 原生身份 | Study/Vocab `device`；模考 `harmony-local-device` | 两套现有范围不可为视觉统一而合并；网页账号与本机原生记录边界说明明确 |
| 四主题 | persisted `paper/crystal/hollow/silk` → display `day/night/hollow/silk` | theme-only `saveTheme` 保持云目标/偏好；新用户默认 paper；既存四 ID 与 schema 不迁移 |
| 三种备份 | 学习 JSON `audioIncluded:false`（现有 UI 只导出）；词库 ≤20MB 合并；模考 ≤224MiB 完整 owner 范围恢复含资源 | 分入口、格式与范围，禁假恢复入口；导出占位空数据不能被称为有效备份 |
| 资料记录 | 原站打开与实际打卡分开；整数 1–240 分钟、负荷、手记；note `[资源:<id>] title\n手记` 截至 1000 字符 | `addCheckin` 成功才关闭/更新统计；失败保留表单，不以打开外链记学习时间 |
| 通用查词 | 按需真字典/场景词、失败重试、真实许可来源；不增加假 API | 中文 IME/软键盘、长释义；详情返回 query/scroll/焦点；收藏 pending/error 及旧词条 ID |

本轮 `lib/study-model.ts` 的业务改动只把 `DEFAULT_PROFILE.theme` 从 hollow 改为 paper。`ui-theme.ts` 只投影 html/body 外观；不读写 storage。不用 UI 重设计机会改复习算法、备份协议、账号/DB 范围。

## 3. 实际读取信号：发现、修订与证明

`lib/use-study.ts` 原有流程的 `load()` 读取失败时会设置私有 `readOnly=true` 与 `sync='blocked'`，随后仍 `setReady(true)`。原有 `issues` 可能为空，或在切 owner 失败时残留前一 owner 的 op 行。因此：

- `ready` 只代表初始化流程完成，不能证明当前 owner 记录可读。
- `issues.some(session 非 waiting)` 不能覆盖本机未来版本、读取错误。
- `sync==='blocked'` 也可能只是单条记录上传被拒，合法本机快照仍可读；把所有 blocked 禁导出会过度封锁。

Root 已在现有 hook 的 **return 处**新增只读投影：

```ts
recordsReadable: ready && activeKey.current === key && !readOnly.current
```

未修改加载、读写、重试、代次、readOnly 或存储算法。UI 可据此禁用导出与不可靠的资源统计，并显示读取受阻；不能把占位 0 次/0 分钟当作已核实学习历史。测试真实 hook 证明：

1. 本机 future-schema：ready=true、blocked、issues 空、recordsReadable=false，原字节不改，saveTheme/addAttempt 拒绝。
2. 切 owner 首次 render 的旧快照：recordsReadable=false；新 owner 读取失败且残留旧 op 行仍 false。
3. 单条 op blocked + 有效本机快照：recordsReadable=true，本机记录仍可用。

这三个断言纳入 `ui-redesign-hook-contract.test.cjs`。它记录现有行为，不增加另一个存储实现。

## 4. 练习的 9 条有效行为回归

`ui-redesign-practice.test.cjs` 读取活跃 `app/learn/practice.tsx` 与 `lib/study-model.ts`，没有复刻 submit 实现来替代测试：

1. onAttempt 失败保持题号/choice，提交进度为 0，无解析/下一题；两次失败后成功重试仍用同一 ID、createdAt、seconds 与答案。
2. 改选清旧 pending；确认另一个选项创建新 ID，仅成功的答案进入保存列表。
3. 两题累计提交恰为 2，正确数恰为 1；已有首答题记 review，另一题 first；不改传入首答记录。
4. Dialog 关闭与 Native Back 打开受控确认；取消继续保持未保存选项与进度，不调用 onClose。
5. Native Back 优先关图片，再次 Back 才开退出确认；优先级 10，卸载注销。
6. 已保存一题、次题失败后明确退出：只保留一条成功记录，不伪造打卡/时间。
7. 完成答题不自动记时间；仅显式“记录时间与收获”触发 onFinish handoff。
8. 保存后听写核对不生成第二条作答、自动分数或打卡。
9. 图片/长材料使用材料和作答区，原文本、英语 lang 标记保留。

这里验证组件行为；不证明真正 Radix 焦点约束、Portal 叠层、图片缩放清晰度、浏览器历史或设备 Native Back 传递。后者列为运行验收。

## 5. 共享样式与测试接口接线

- `app/layout.tsx` 和 `mobile/src/main.tsx` 均先导入 `globals.css`，再导入 `redesign.css`，共享业务入口保持单一。
- `applyDocumentTheme` 写入 documentElement 和 body（含 colorScheme），StudyApp effect 位于模考 early return 前；Portal 和模考分支能取得主题 token，不能只在工作空间 wrapper 上设值。
- 默认日/夜 `ThemeMotif` 返回空；游戏主题 48×48 原创静态 motif 远离题面与输入。同布局与相同成功/失败状态语义，不因主题修改功能。
- 静态 palette 对比测算：次级文本/面板 5.75–7.79、控件边框/选中背景 3.02–3.38、主按钮文字 7.02–9.37。数值只针对读取到的精确色对；最终叠色、透明/hover/disabled、图片上文字需要运行截图/computed style 再核。
- 独立 CSS 同伴曾发现旧 `globals.css:88–90` 的 `!important` 压过 tabs、overlay、dialog 新规则。Root 已在 `redesign.css` 追加明确的优先覆盖：tabs gap/padding/font/圆角/边框、overlay、lesson-tabs 自动高度、Dialog 手机留白，以及 `var(--ui-font)` 栈。当前源码层叠方向正确，尚未亲见最终 computed style。
- 专注态隐藏顶栏、底栏、侧栏；现有 reduced-motion 全局禁动画/过渡。底栏有安全区；原生顶部 inset、forced-colors 及首次主题闪烁仍需运行确认。
- 现有 `repo-review-regressions.test.cjs` 的 `dailyApp` import stub 与 SidebarMenuButton/task-row 查询绑住旧布局。必须适配新 shell/primary/next 卡，保留“当天推荐不被答题/录音改成下一推荐”“准确完成状态”“本地午夜推进”“录音按偏好时区显示，原始时间不变”断言。只删旧测试会丢功能保护。

## 6. actualdiffready 后验收矩阵

| 范围 | 自动行为/构建 | 运行验收 |
|---|---|---|
| 共享入口/CSS | typecheck、Web verified build、现有共享移动构建；全部新 imports 存在 | Portal/mock 主题、320/390/桌面、200%文字、长材料滚动、导航专注隐藏 |
| 学习 shell | 推荐任务固定/完成状态、真实 data/sync/recordsReadable 门禁；学前/学习中/完成后返回 | Back、搜索入口返回原解析页、弹窗焦点恢复；后台不绕过保护 |
| 查词 | 真模型与 lazy-load、失败恢复、收藏/词卡事件、query/detail return | 中文IME、软键盘遮挡、清空、长释义、scroll/focus恢复、原生返回 |
| 口语 | media 模拟时真实 Blob/同 ID、失败回听/下载/重试/明确放弃、saved 门禁、开始时间 | 麦克风真实权限/停止事件、播放器/下载、ArkWeb生命周期、真实焦点 |
| 模考 | FIFO/CAS、超时锁定、保存成功才到结果；原题型/题包/attempt 身份、原 deadline；明确应急退出 | 真音频和长材料、答题卡、保存失败重试、旧制双篇、图片层 Back |
| 资料/备份 | 成功后统计、失败保留表单、记录范围、3格式及 owner guards | 真实文件下载/恢复流程、设备范围提示、外站打开可达性 |
| 无障碍/性能 | 静态色对、语义名称、无动画尊重偏好；无新素材阻塞包 | 键盘/读屏、200%/400%文本、系统高对比、触控44px、低端设备及按需词典 |

关闭条件：相关核心、新回归与正式构建通过；运行检查范围和未做设备项如实标记；设计方/父会话安排同一独立评审者复验。不能用 Node fixture 测试代替真实媒体或学习持久化验收，也不能把未做设备测试倒推为设计稿必然失败。

## 7. 本轮交付与尚未完成

- `engineering/tests/ui-redesign-practice.test.cjs`：9 条真实组件回归，通过。
- `engineering/tests/ui-redesign-hook-contract.test.cjs`：5 条真实模型/hook/theme 合同，通过。
- 本文件：实施前及集成中证据框架；没有编辑正式业务 code/docs。
- 待根集成完成通知 actualdiffready 后再审最终 diff、测试入口、剩余旧 UI harness 和构建。当前 68/69 的那条口语旧测试尚待作者提交适配并重跑；不会把中间态 imports/缺模块当最终实现缺陷。
