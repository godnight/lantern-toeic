# 独立评审：测试、构建与可维护性

评审日期：2026-10-13。评审者：`test_maintainability_review` 独立子代理。范围：实际测试实现、CI、构建/资源/发布工具链、维护文档，以及 UI 整理涉及的回归边界。此文件是独立意见原稿，集成负责人尚需逐项回应；不代表第三方 GitHub 审批。

源码根：`D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site`。本机核实 HEAD 为 `12317b26b85a71888760b0cc18242d00a843ac74`，初次 `git status --short` 无输出。为只读查询使用命令级 `git -c safe.directory=...`，未修改全局 Git 配置。未安装依赖、运行构建、启动浏览器、连接设备、操作用户数据或发布。主评审代理另行运行学习单测和无增量类型检查，本评审未重复执行。

读取依据：`AGENTS.md`、`README.md`、`docs/TEAM.md`、`docs/PROJECT_STATUS.md`、`docs/CODEX_HANDOFF.md`、`docs/MAINTENANCE.md`、`docs/ARCHITECTURE.md`、相关版本验收记录，及下列实际实现。优先级 P1 表示相关边界变化前必须补齐，P2 表示渐进整理应纳入，P3 表示后续维护优化；未发现须阻断本次纯文档归档的 P0。

## 1. 关键判断

测试资产并非只做源码字符串检查。现有 Node 测试执行真实 TS/TSX 业务源码、真实 SQLite SQL、fake-indexeddb 事务；Core CI 还运行 Chromium 里的共享前端、媒体元数据、导入导出、DOM 与动画时间轴。应保持这些已有能力，再补具体运行边界。

- 学习首答、复练和同步已有行为基线：`tests/study-invariants.test.cjs:189`（首答按时间排序）、`:199`（账号切换）、`:209` / `:231`（多标签页/存储事件）、`:255` / `:266`（拒绝与重试）、`:452`（旧 GET 不能覆盖新 profile）、`:515` 至 `:651`（主题专用操作与并发）。这些用模拟浏览器/React/I/O 执行真实 `lib/use-study.ts`，不能当作真实多浏览器联调。
- 云题包竞争并未缺测：`tests/exam-library-api.test.cjs:20` 至 `:39` 以真实 SQLite、受控 R2/auth 替身执行真实路由；`:79` 至 `:109` 覆盖同 SHA、最后名额、2 GiB 额度竞争及模糊失败/清理失败。持续集成不足在真实 Cloudflare/身份运行边界，不在全部并发逻辑。
- IndexedDB 升级已有测试：`tests/exams.test.cjs:365`、`:373`、`:378` 覆盖 v1→v3 原始行保持、旧连接关闭、新版本拒绝。D1 也有一条旧 profile 行的增量迁移测试（`tests/study-data-v2.test.cjs:27` 至 `:33`）。不能写成“只有空库迁移、完全没有升级测试”。
- 当前云题包下载只同步题包，不能解释为考试记录或原生学习记录云同步。`tests/exam-library-ui.test.cjs:24` 至 `:26` 验证原生入口只给认证浏览器引导、无 API 调用；`docs/PROJECT_STATUS.md:23`、`docs/CODEX_HANDOFF.md:15` 明确考试记录留在本机。

## 2. 问题与建议

| ID | 优先级/影响 | 证据与结论 | 渐进建议与完成标准 |
|---|---|---|---|
| TM-01 | P1，身份/数据边界变化前 | API 单测均替换 `@/lib/server-auth`：`tests/exam-library-api.test.cjs:37` 至 `:39`、`tests/study-data-v2.test.cjs:101`、`tests/vocabulary.test.cjs:135`、`tests/theme-persistence.test.cjs:151` 至 `:154`、`tests/study-invariants.test.cjs:336` / `:348` 至 `:354`。未发现测试直接加载真实 `lib/server-auth.ts` 或身份头。真实 `safeMutation`（`:3`）允许无 Origin，与部分固定 Origin 替身不完全同构。`tests/helpers/cloudflare-test-loader.mjs:1` 至 `:6` 亦明确没有绑定/托管身份。此为信任边界覆盖缺口，不据此断言泄露。 | 先给真实 helper 加来源/无 Origin/错误 Origin/可信头缺失/private no-store 契约，再对真实路由做隔离 workerd/D1/R2 集成。受支持托管环境必须验明身份头由网关注入/过滤、跨账号拒绝。不得把本机 helper 单测升级成线上网关已验收。 |
| TM-02 | P1，D1 schema/存储变化前 | `core.yml:72` 至 `:82` 将全部 SQL 应用于空 SQLite。`study-data-v2.test.cjs:27` 至 `:33` 只种一条旧 profiles 行。不能验证完整既有 attempts/checkins/recordings/vocabulary_events/exam_library 数据、实际 D1 迁移账本及中断恢复。 | 为每个已发布 schema 建匿名合成带数据 fixture；验证旧行、外键/唯一约束、迁移版本、同 ID 的账号隔离和失败后恢复。不要求原始 SQL 重复裸执行，要求受支持迁移 runner 的已应用迁移判定正确。保持现有 IndexedDB 升级回归。 |
| TM-03 | P1，原生 ETS/bridge 变化前；P2，持续门禁 | 常规 `harmony-web.yml:27` 至 `:39` 明确“no SDK compilation”；根 `tsconfig.json:44` 排除 `harmony`。`harmony/tests/entry-ability.test.cjs:7` 至 `:14`、`native-downloads.test.cjs:7` 至 `:8` 用 TypeScript transpile 和平台替身，不能检查 ArkTS/SDK 完整约束。发布流程确有 SDK 编译（`source-release.yml:93` 至 `:97`），因此是 PR 层盲区而非没有原生构建。 | 共享 UI 变化保留资源核对；ETS/权限/native host 改动至少在独立 SDK job/开发验收执行真实编译。交付分别记录共享资源哈希、unsigned HAP 校验、签名校验、指定设备覆盖安装/生命周期。普通 CI 仍如实标注资源检查。 |
| TM-04 | P2，检查入口漂移 | `package.json` 的 `test:study` 是显式文件列表；Core 调 `codex-setup.sh:21` 至 `:25` 后另跑 build-timeout / MJS / 浏览器；发布用 `tests/*.test.cjs`，但 `source-release.yml:54` 至 `:62` 只跑考试/词典浏览器，遗漏 Core 的两种主题浏览器（`core.yml:54` 至 `:55`）。`npm test` 自身也不含 typecheck、validate:art、browser 或原生检查。 | 用一份可读验证矩阵定义每种入口的范围，再让 Core/发布共用必要的 browser group 或显式解释差异。新测试自动进入对应组，或用确定性清单检查防漏。不要把 `npm test` 通过描述为全端验收。 |
| TM-05 | P2，测试替身维护成本和生命周期盲区 | 多个套件各自实现 `transpileModule` / VM imports / React hook slots：`study-invariants.test.cjs:10` 至 `:18`、`repo-review-regressions.test.cjs:11` 至 `:34`、`dictionary-ui.test.cjs:7` 至 `:27`、`exam-library-ui.test.cjs:5` 至 `:17`、`native-lifecycle.test.cjs:12` 至 `:23` / `:73` 至 `:92`。`dictionary-ui.test.cjs:21` 将 `useDeferredValue` 直接返回当前值；多个 hook renderer 由手动 render/flush 驱动。旧报告也记录新模块使浏览器桩失配（`TEST_EXECUTION_v0.3.3.md:29`）。 | 先共用模块加载、deferred、受控 fetch/存储助手；保留场景独立 fixtures。不要合成一个巨大“测试框架”。对账号切换、清理、迟回包等重要生命周期补真实 React StrictMode/浏览器执行。现有行为断言原样保留，逐组迁移，避免为了拆文件改模型。 |
| TM-06 | P2，UI 样式跨迭代覆盖 | `app/globals.css:145`、`:272` 至 `:276` 为早期 atlas/主题覆盖；`:305` 至 `:313` 再写主题 token 和桥接；`:369` / `:454` 至 `:461` 再覆盖 workspace、panel、task、resource、word；`:670` 明确截图后再追加覆盖。多处 !important/跨组件规则依赖追加顺序。风险来自相同责任的多层 cascade，不是文件字节数。 | 先固定 four-theme × 页面 × dialog × 响应式状态矩阵；再将主题语义 token、shell、通用控件、词典、模考样式责任分开。逐段替换并删除被替换规则，比较真实 computed style 与截图，不一次性格式化并改视觉。新四主题与旧 profile ID 的映射由 UI/数据负责人共同决定。 |
| TM-07 | P2，文档接续误导 | `docs/ARCHITECTURE.md:31` 仍把“全题组模考”列为后续计划，实际 `app/study-app.tsx:71` 已挂载 `MockExam`、`lib/exam-storage.ts` 已存完整考试；`:11` 缺 vocabulary_events / exam_library 现状。交接顶部更新到 PR #45（`:3` 至 `:9`），末尾复制提示仍绕回 v0.3.1/T1+T2（`:229`），`:222` 仍称真机连接待完成，与 `PROJECT_STATUS.md:31` / `:33` 的设备验收历史不一致。 | 归档保留历史和日期，建立一个短的现状入口/索引，明确源码 SHA、源码版本、部署、HAP 与设备验证各自状态。失效段落标历史/替代文档，不能仅追加更多“最新”段落。学习 JSON 不含录音 Blob（ARCHITECTURE.md:15）仍应保留，不能与题包完整备份混为一谈。 |
| TM-08 | P2，私人云库浏览器回归无法持续重跑 | `TEST_EXECUTION_v0.3.3.md:15` 至 `:18` 记录 16 条真实 Chromium 新功能流程但 API 为本地模拟。当前持续 CI browser 命令是 exam/dictionary/themes；`tests/browser/full-exam.cjs:283` 至 `:412` 主要是本机题包，`theme-browser.cjs:177` 至 `:187` 仅替换 /api/study，词典脚本使用静态共享前端。持续脚本没有与历史 16 条云库交互相对应的受控 /api/exam-library 流程。 | 将已验证合成云库流程纳入可重跑的 browser 脚本：上传前切账号、晚回包、下载取消/校验失败、进度清除、重复点击、409/HTML。使用独立账号与合成题包，不碰私人材料；随后另跑实际运行时 route 集成。 |
| TM-09 | P2，PWA 离线与更新路径 | 现有三组浏览器脚本均 `serviceWorkers:'block'`：`full-exam.cjs:194`、`dictionary.cjs:33`、`theme-browser.cjs:173`。查词报告明确排除 SW 离线缓存（dictionary.cjs:11）。源码 `StudyApp` 注册 SW（study-app.tsx:54），因此这些测试不能证明私有响应不被缓存、离线冷启说明、cache 更新/旧标签页行为。 | 独立 SW suite：合成数据、SW enabled、新/旧版本更新、已打开练习离线保存与冷启动说明；断言 API/身份 HTML/私人响应不进入 Cache Storage。Web 静态离线与原生内置资源各用不同结论。 |
| TM-10 | P3，维护规则未强制 | `package.json` 有 lint，Core 初始化 `codex-setup.sh:21` 至 `:25` 和发布 validation（`source-release.yml:31` 至 `:43`）均未执行。类型严格（tsconfig:11）有价值，不能代替 Hooks/unused 等规则。 | 先核实 lint 的现有欠账，再对新改文件采用可执行的规则；合适时纳入 CI。不能在未运行 lint 时声称 lint 失败或立即全库修复。 |

## 3. 测试资产分类与实际边界

| 层级 | 现有资产及证明能力 | 不能据此证明 |
|---|---|---|
| 纯模型/协议 | 学习首答/间隔、题包结构/指纹/分数、词条/事件/备份解析，真实 TS 模块 | UI 可读性、媒介正确发声、服务端身份可信 |
| 真实模块 + 替身 | useStudy/useVocabulary/录音 TSX；hook slots、网络、media 替身；账号/重试/异步清理 | React 调度全部语义、真实浏览器多标签页、ArkWeb lifecycle |
| 真实 SQLite + 平台替身 | StudyData v2、vocabulary、theme、exam-library SQL，预约/并发/失败恢复 | 实际 D1 API/迁移账本/网络/事务行为与 R2 运行时 |
| fake-indexeddb | 本机题包事务、配额失败注入、版本升级、revision 竞争 | 实际设备配额、存储回收、系统强杀/低空间 |
| 构建后的 Node SSR | rendered-html.test.mjs:7 至 :38 加载 dist/server/index.js；UI 静态标记/CSS utilities | 登录后真实浏览器 hydration、D1/R2、部署网关 |
| Chromium 共享前端 | full-exam、dictionary、theme-browser；实际 DOM/媒体元数据/下载/IDB、四视口/动画时间轴 | SW 缓存（被 block）、实际托管身份、物理设备、持续两小时听力 |
| 源码/配置契约 | repo-review-regressions:300 至 :306 删除目标/权限/ignore/RFC 文案；CSS 输出正则、HTML 标记 | 不构成同名行为已经运行的证据；只适合补充静态约束 |
| Harmony 资源核对 | sync-web.mjs:23 至 :43 逐文件字节/SHA、文件集合和 manifest 校验，并声明 nativeBuildVerified=false | HAP、签名或设备；这些在发布/设备验收另有独立证据 |

当前测试没有将每个断言都堆成源码字串；很多 `assert.match` 检查实际模块生成的文本/HTML，是合法的组件契约。应按输入、被执行层和替换的依赖判断，而不是按断言函数名分类。

## 4. 与新 UI 设计线的约束

1. 四套新主题（无 IP 日间/夜间、空洞骑士、丝之歌）不是仅改颜色名。现存 `theme` 保存在 profile、备份、离线 journal 和 D1；新 ID/旧 ID 转换必须覆盖现有 theme-only POST、旧 profile pending ops 以及刷新/账号切换。`theme-persistence.test.cjs:58` 至 `:223`、`study-invariants.test.cjs:515` 至 `:651` 是行为基线。
2. 搜索须保留中文后义、屈折词形、收藏后筛选、延迟词典加载、错误后原场景词可用、来源/作者历史/CC BY-SA 链接。`dictionary-ui.test.cjs:36` 至 `:83`、`browser/dictionary.cjs:40` 至 `:55` 已覆盖这些含义。新搜索可变更展示和排序，但不得丢词条 ID 或把通用词典计作托业词表。
3. 活动模考使用隔离 shell（study-app.tsx:71），旧回归要求外围导航不可静默卸载考试（repo-review-regressions.test.cjs:310 至 :320）。设计的新导航/全局搜索/主题切换不能绕过保存、退出确认和 deadline；答案/解析仍须交卷后出现。
4. 所有背景动效与按钮微动需覆盖系统 reduced-motion、document.hidden、native foreground、离屏及学习/设置/dialog 暂停。`theme-atmosphere.test.cjs` 执行真实组件，但 native lifecycle 仍要 ArkWeb 验证。
5. 现有主题浏览器 61 条/4视口属于旧版历史证据（VISUAL_POLISH_2026-10-12.md:27 至 :39），可以复用场景能力，不能直接标记新四主题“已验收”。固定色值与旧 catalogue 标识更新必须和新语义契约一起审查，不能只把断言改成更宽泛的存在判断。
6. 必须保留本机/云库/在线同步的准确可见状态。原生云库只有“浏览器登录下载”入口，题包下载成功不等于作答记录同步。

## 5. 渐进整理与门禁

建议按边界逐步整理，不按超大文件拆分数量验收：

- 阶段 A：现状/历史文档分离、验证矩阵/命令列表统一、真实 auth helper 契约。文档先可追溯；不改生产算法或数据格式。
- 阶段 B：公共测试助手；保留每个场景的失败断言、API 替身边界说明和单独测试范围。一次迁移一个 suite，比对迁移前后的场景覆盖；不以总通过数代替含义。
- 阶段 C：UI token 与 shell/view responsibility；优先 CSS cascade 重复、可复用 dialog/状态展示，保留同步 hook 和 exam storage 事务。实际截图/computed-style/keyboard/reduced-motion 与加载/错误/空状态各自通过。
- 阶段 D：存储/同步职责抽离，先补隔离 runtime 与迁移证据。每次只迁出一个 adapter/状态协调器，旧 keys/schema/包 fingerprints/record IDs 保持兼容；不可同时重写模型、hook 和 UI。

回归最低标准：首答/复测记录、间隔等级、考试固定 deadline、匿名合成旧备份、本机账号分区、先保存后成功反馈、上传/下载迟回包、词典失败降级、新主题迁移和恢复可复核。模型/组件/SQLite/Chromium/原生报告分开，不汇总为“全部端到端通过”。

迁移标准：对旧 schema 的合成记录逐字段比对，旧客户端/旧标签页行为明确；升级不能静默清空失败数据；新版拒绝未知 schema，保留原字节与用户导出入口。完整音频备份、学习 JSON 元数据备份、词库备份、题包完整备份是不同资源，分别测试。

回滚标准：schema/key 不变的纯 UI/代码迁移可回退对应提交并验旧 reader。已升级 IndexedDB（当前测试明确旧 v1 reader不能打开v3）或 D1 schema 后，不能承诺直接装旧 HAP 即可回滚；应先证明旧 reader兼容，或以向前修复/受控合成备份恢复方案处理。不得通过卸载、清数据、降版本号或移动 release tag 来恢复。

## 6. 分歧点、回应待办与评审结论

本评审提出以下可供集成负责人回应的观点，未虚构已举行的多人讨论：

- 不同意把现有测试归类为“只检查字符串”或“完全没有并发/升级测试”；上述真实 SQLite/IndexedDB/Chromium 和并发案例应写入现状。
- 不同意仅因 mock-exam.tsx/globals.css 大就直接拆分；需先固定 UI、deadline、事务、媒体/账号生命周期契约，按重复责任/跨层依赖渐进整理。
- 认可默认 PR CI 的轻量原生资源检查，但原生改动必须补真实 SDK 层；不能把资源 check 改名为原生全测。
- 认可历史真实 R2 探针和真机验收记录的价值；这些证明已记录版本/场景，不能替代未来重构的可重跑覆盖，也不能冒充本次重新运行。

集成负责人回应栏：待主评审综合时填写采纳/调整/暂缓及理由；本文件未代替主代理作出决定。

### 交叉评审回应（2026-10-13）

主评审代理发回数据可靠性与架构评审的合成探针结果。本评审没有重新运行这些探针，已静态核对相应生产代码与现有测试替身，回应如下；正式归档应链接原探针脚本/日志，保留原作者和执行范围。

| 兄弟评审复现/现状 | 本评审优先级与回应 | 当前测试为什么未揭示/应补契约 |
|---|---|---|
| 同 owner 同 recording ID 换 Blob 后，D1 留旧 meta、R2 留新 bytes | P1。这是录音幂等/内容一致性风险，整理录音接口前先修复并冻结回归。`app/api/recordings/route.ts:7` 先 R2.put，再 D1 `onConflictDoNothing`；`db/schema.ts:5` 使用全局 id 主键。不能依赖 UUID 概率代替重放契约。 | `tests/study-invariants.test.cjs:345` 至 `:361` 的 DB 替身只捕获 values，没有现有行/唯一约束，R2.put 为空函数。补真实 SQL + 可读对象替身：相同 ID/相同 meta+bytes 重放幂等；相同 ID/不同 meta或bytes明确拒绝并保留旧对象；R2成功/D1失败不得返回持久保存成功，失败修复可重试。 |
| 跨 owner 复用 recording ID 返回200，但当前 owner 没有 D1行 | P1。返回成功可能触发客户端 uploaded=true 与缺失本机修复入口，属于可靠保存而非已证实跨账号读取泄露。代码已有 GET 的 userId scope，不应宣称读取隔离失效。 | 同一实际 SQLite 中种 owner A 的行，再上传 owner B 同 ID，断言响应、D1双方行、R2双方键与重试状态。不允许“无当前 owner 行却200成功”；此回归与通用 auth helper测试互补。 |
| 主 snapshot 为坏 JSON，被读作空数据；新打卡覆盖原始字节 | P1。`lib/use-study.ts:14` 至 `:16` 将坏 JSON变null；`:34` persist可重新写同key。数据保护需将“缺失”与“损坏”区分。 | 现 `study-invariants.test.cjs:220` 至 `:223` 主 snapshot 有效，仅辅助 profile/recording key坏，覆盖本身有效。新增坏整份 snapshot、不合版本/结构、部分 journal仍可恢复的场景：任意 save/retry/refresh不得覆盖损坏原字节，显示可恢复/只读状态；显式恢复流程另验。 |
| API 接受2026-02-31，备份解析拒绝 | P2。`app/api/study/route.ts:14` profile仅Date.parse判定，`:16` checkin仅正则；`lib/study-backup.ts:6` / `:11` 使用 validStudyDate。属于写入/导出/恢复契约不一致，需统一真实日历日期语义。 | 加有效闰年/非闰年、月末、缺失/空日期、无效日期矩阵：API写入后可通过相应导出与恢复；对既有非法记录先确定保留/隔离/修复策略，不能静默改写用户日期。现测试不应只用模型自己的正确日期样本。 |
| 并发首答可产生两条 mode=first，但firstAttempts仍按最早事件统计 | P2标签一致性。`app/api/study/route.ts:30` 至 `:31` 的先查后插具有竞争窗口；不把它扩大为已证实首答正确率错误。 | 并发路由测试断言同时到达的mode、firstAttempts结果和备份含义，保持两条作答事件。根据产品定义决定mode为服务端标记还是派生属性，独立于首答统计。 |
| QuestionMark/ResourceTask/restoreBackup具备模型、hook和路由接口，未接 UI | 维持“接口已实现、UI计划中”分类。ARCHITECTURE.md:21 的这部分仍可保留，并以具体UI接入状态澄清。 | `lib/use-study.ts:154` 至 `:168` 接口测试通过不等于错误分类、任务编辑或学习备份恢复界面验收。未来 UI实现另加实际DOM/下载/文件选择器以及失败不关闭dialog的交互契约。 |

这些发现支持先建立最小可靠性补丁，再做结构迁移；本次授权仍只做评审/文档，不在本评审中修改生产实现。已有 mock/SQLite/升级测试继续作为有效基线，新增用例覆盖的是此前没有建模的故障或边界。

独立结论：允许继续本次架构文档归档与整理方案；任何身份、持久化、原生 bridge 重构先满足对应 P1 门禁。下一轮优先固定新 UI 的语义/主题兼容与回归矩阵，再整理测试助手和 CSS 责任，最后在隔离运行环境证据完整后迁出同步/存储职责。

验证范围：本评审仅静态源码/文档/CI 检查及只读 Git HEAD/status；没有新增执行成功声明。父代理执行结果应在正式验证记录另列。
