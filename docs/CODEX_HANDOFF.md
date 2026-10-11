# Codex 开发交接

更新：2026-10-11。代码仓库：[godnight/lantern-toeic](https://github.com/godnight/lantern-toeic)。当前只维护Web/PWA和HarmonyOS；Android/iOS工程、专用工作流及Capacitor已删除，旧源码留在Git历史。

## 正在接续：原生模考独立 runner（2026-10-11）

PR #32 已合并。PR #33（分支 `test/harmony-mock-automation`）为草稿，已实现原生模考短回归、可选真实截止时间观察及最终备份校验；111项Python离线回归和198项学习检查通过，新runner首轮空Web等待问题已修复，完整独立重跑待验。先核对该分支最新PR状态再接续。新脚本说明 `harmony/scripts/ui/MOCK.md`，报告 `docs/testing/HARMONY_MOCK_AUTOMATION_2026-10-11.md`。长模式显式传 `--observe-deadlines`，整轮默认/最大8400秒；不可与其他观察争用设备。发布工具还补齐历史最高versionCode检查；不改release-manifest，不重发v0.3.0。

原同次考试于10:44切换阅读、11:59自动交卷，原截止11:59:25.588（Asia/Shanghai）没有延后。10:34实例曾退出，重启同实例后继续观察，不能算连续两小时前台。观察进程与自动收尾均已终止；收尾先发现测试脚本把热补丁0占位值误作App版本，修复后12:02实际导出与原B3比对通过，证据 `87-original-timeout-final-backup-retry`。模拟器现为题包目录且旧考试已交卷，可独占运行新套件。私有接续文件 `vocab-work/simulator-acceptance-20261011/CONTINUE-real-deadline-observer.txt` 记录实际后续进程与输出路径，以实时活进程/最终退出状态核验。不要触碰物理手机、清数据、改系统时钟或并发操作模拟器。

## 最新接续：模拟器已完成部分模考验收（2026-10-11）

本人已明确同意并通过官方流程接受四份模拟器协议。既有 HarmonyOS 7 / API 26 镜像可用；CLI 原先使用了不匹配的 SDK 根目录，官方 Emulator.exe 的 `-imageRoot` 应指向包含 system-image 的用户 Huawei SDK 根目录，不能直接指向 system-image。不要再把协议确认或镜像下载列为当前阻塞。

专用实例 LanternOffline7 已覆盖安装 v0.3.0 / 20006；每次操作仍须重新核查实例及显式 HDC 目标，禁止因手机已连接就改动用户正在使用的物理机。词库 runner 两处遮挡/快照缺陷已修复，35项离线检查及最终真实 smoke 通过。先核对 `fix/harmony-ui-occlusion` 对应 PR 状态，合并后从最新 main 接续；GitHub 与 Sites 的提交历史独立，不直接互推本地提交。

模考受控 CLI 完成两套合成包导入、媒体预检、两答案冷启保存、原生下载与两次幂等恢复，四份实际备份经模型核验。图片放大、双向滚动、Back返回也通过。它尚非完整无人值守模考套件；完整真题、真实45分钟切换/两小时交卷及新版真机仍待验。详见 `docs/testing/HARMONY_MOCK_QA_2026-10-11.md`。本轮仅测试工具和文档，不重发已有HAP/Web/标签，不重部署Site。

结束时模拟器停在成长足迹，原页合成模考保留2道答案，计时没有暂停或重置；已有学习页首答2题、录音0段的计数仍在，但未做全部旧数据逐字段迁移核验。接续勿卸载、清数据、修改系统时间或编辑应用私有数据库。本地证据位于 `vocab-work/simulator-acceptance-20261011`，不要将原始布局、设备信息或完整备份上传公开仓库。

## v0.3.0 发布与原页工具基线（2026-10-11）

新增本机原页打包工具在 `scripts/pack-exam-pages.cjs`，说明 `docs/EXAM_PAGE_PACKER.md`，PR #31 已合并。它兼容既有v0.3.0，不改App/题包格式，不要求重发HAP或Site。161项学习检查（含26项工具检查）、真实PDF转换及22条浏览器流程已在本机通过，详见 `docs/testing/EXAM_PAGE_PACKER_2026-10-11.md`；原版本228项机器检查/18流程仍是历史发布证据，勿把两轮数量简单相加。

Windows捆绑Poppler缺少pdfdetach，完整26.07.0工具已在私人vocab-work目录；CI自行安装poppler-utils。新浏览器链路只用原创控制材料，不能记为取得真实卷。私有Site未完成登录后的线上复验。用户睡觉期间不要求其重复登录、重签名或操作手机；模拟器协议已在后续明确授权后接受。

从 GitHub 当前 main 接续。PR #29 已合并，v0.3.0 标签/功能基线为 `88dd510fdbbf9edaef0370ff537f463142c9ca2c`，树 `60c436a7dcba3f0127cffb3e0fd175ec59ec1eba`；发布 run `38073334481` 成功，附件以实际发布 SHA256SUMS 为准。随后文档提交只记录发布结果，不覆盖已发布标签或附件。

Sites 版本 9 已部署对应功能，源提交 `2d342626cb23389021a10ba8b8b1b5c76b3568d2` 与上述功能基线同树；最新文档提交不要求重建未变化的网页。所有者私有权限未变。线上浏览器复验遇到连接超时，不能把部署成功写成手机已经打开。

整卷格式在 `docs/EXAM_IMPORT.md`，存储与计时设计在 RFC 0005；本机 228 项机器测试和 18 个浏览器流程通过，CI 也已运行浏览器门禁。新版本地签名 HAP 在私人交付目录，未安装到手机；旧真机录音/词库证据只适用于原验收范围。下一步在专用设备或本人明确交出且空闲的手机上验证完整卷/后台及真实听音，不卸载或清空学习数据；模拟器文件下载补充结果见最上节。

多套官方完整卷仍未取得；私人交付仅有 60 题官方原样 PDF，不能当成整卷或公开打包。真实硬件验收、材料取得、手机号与云同步的账户配置仍待推进。发布与后续事项见 `docs/releases/v0.3.0-published.md`。

## v0.1.0 发布历史（2026-10-11）

PR #28 已合并，GitHub main/tag v0.1.0 为 `859a39f18eb4c3d95445ff08e37b3226335bfc23`；7 个预发布附件已完整上传并核验。相同内容的 Sites 源提交 `f3fbac42dae8f7907b5377c1e44d5bafe645c823` 已部署成功，原所有者私有地址不变。GitHub 与 Sites 仍保留独立提交历史。

模考分支 `feat/full-listening-reading-mock` 曾从此基线开发 v0.3.0 / versionCode 20006，现已合并。个人题包不进入公开仓库，勿把旧 v0.1.0 的真机证据扩大到新功能。

Windows Sites 打包使用已安装 Codex Node 24.19.0 + Git Bash，当前进程设置 `TAR_OPTIONS=--force-local`。普通 Node 24.13.1 在 fs.cpSync 原生崩溃；插件 npm shim 仍有路径问题，直接 PowerShell npm.ps1 可安装锁定依赖。凭据仅经 helper stdin 传递。

## v0.1.0 准备阶段历史（2026-10-11）

PR #26 与 #27 已顺序合并，GitHub main 为 `70081a47059036d11e731cb2166975aab453fd5f`，内容树与本地真机修复基线一致。v0.1.0 测试发布准备中：报告见 `docs/testing/TEST_EXECUTION_v0.1.0.md`；发布计划见 `docs/RELEASE_PLAN.md`。当前默认范围是 12 月 20 日听读，口语后延。后续功能版从 v0.3.0 继续，避免覆盖历史 v0.2.x 标签。

Windows Web 构建现在由 Node 包装器直接启动锁定 Vinext，避免 PowerShell 把 Bash 转入缺少 Node 的 WSL；Linux CI 保留既有脚本。设备自动化在 `harmony/scripts/ui`，27 项离线测试通过，live 首跑待模拟器协议确认，不能写成端到端已通过。

## 最新真机接续（2026-10-11）

词库位于 [PR #27](https://github.com/godnight/lantern-toeic/pull/27)，以 PR #26 的 `test/harmony-offline-validation` 为基线；先核对合并状态。本人开发者 CLI 登录、AGC 设备登记、开发签名和 Pura X Max 安装已完成，不要重复要求这些前置。

真机离线冷启动、折叠/展开布局、词库、JSON 重复导入、内置发音、麦克风录音切后台保存及冷启动回听均有实际证据和用户听音确认。发现录音日期错误使用 UTC 切片，已按配置时区修复，自动化先失败后通过，并覆盖安装在同一录音上回归。见 [真机报告](testing/HARMONY_PHONE_QA_2026-10-11.md)。当前签名包 SHA-256 `64076cee2802ad2803496217909c65b22aa00791e2fe31f165d8e9a5ebc3487d`；签名材料仅在本机隔离 staging，不能覆盖到 Git。75 项学习/词库及 5 项 Web 产物检查通过。

原生仍为本机离线版；手机号登录、原生云同步、发行签名和商店发布未完成。真机拒绝麦克风、长时间后台/锁屏、大字体及其他机型未验。本轮未发布 Site；此前词库网页包上传超时，不能把源码提交当作线上更新。以下旧状态结合此节阅读。

## 最新词库分支（2026-09-19）

先核对 `feat/toeic-vocabulary` 的 PR；它建立在尚未合并的 PR #26 `test/harmony-offline-validation` 上。包含240场景词、55额外题内表达、双语搜索/生词/自测、独立词库JSON备份、网页D1同步与鸿蒙离线语音。详见 PROJECT_STATUS 和 RFC 0004。只检出旧main会丢失两个阶段改动。

新迁移 `drizzle/0002_parched_edwin_jarvis.sql` 仅新增 vocabulary_events。词库进度不属于 StudyData v2 / 原个人记录备份；不得塞进 Attempt、QuestionMark 或 /api/study。鸿蒙owner仍为null，不要声称手机号或原生云同步已经实现。`npm run test:study` 已加入20项词库测试，合计74项；完整相关自动化99项通过。

2026-09-19本地Sites插件目录在运行中消失，已搜原缓存未找到；生产构建改用已锁定安装的 `npx --no-install vinext build`（与原helper最终构建命令相同），正式Worker本地hydration通过。原始 `npx vite` 开发预览存在React重复加载问题，勿把dev错误或静态截图当成生产发布失败。发布沿用当前owner-private Site；原账号授权未扩大。最终部署结果和PR状态需检查本轮交付。

## 先选对分支

PR #18 平台收敛、#20 数据基础、#21 地图改版、#22 去地名、#24 离线 HAP/内置语音、#25 原生导出均已合并。2026-09-19 核实 GitHub main 为 `b8da1526e21f4369998fe58bae1ad6105962292f`。本轮设备回归修复在 [PR #26](https://github.com/godnight/lantern-toeic/pull/26)，分支 `test/harmony-offline-validation`；接续时核对实时 PR 状态：

- PR未合并：从PR分支接续，不能只检出main后重做或遗漏现有工作。
- PR已合并：拉取最新main，再创建任务分支。
- 不强推、不重写历史，不把聊天中的旧SHA当作永远不变的分支头。

PR #18 完成平台收敛和交接，手机号认证与 HAP 仍由独立任务跟进。最终提交与 CI 结果以 PR 页面为准，不再沿用“main 仍是 v0.2.3”的旧交接说明。

## 接续初始化

先读 `AGENTS.md`、本文件、`README.md`、`docs/PROJECT_STATUS.md`、`docs/TEAM.md`、`docs/rfcs/`。使用Node.js 22.13+，在仓库根目录运行：

```bash
bash scripts/codex-setup.sh
```

该脚本只安装根目录锁定依赖，执行类型、内容、素材及行为检查。`mobile/`保留鸿蒙共享网页入口，没有单独依赖安装。首次安装需访问锁文件对应的npm源；普通Linux构建另需GNU `timeout`。不需要生产凭据即可运行源码检查。新Codex环境的仓库访问和安装网络权限须在其运行环境中配置，不随克隆自动继承。

## 当前状态

| 项目 | 已完成 | 未完成或边界 |
|---|---|---|
| Web/PWA | 今日任务、练习解析、口语录音、复习、周复盘、资料书库及鸿蒙桌面指引 | 目前用ChatGPT托管身份，手机号认证未实现 |
| 在线版本 | 沿用既有私有 Site 地址及 custom/owner 权限；本轮未部署 | 以 Sites 实际部署记录为准，GitHub 合并不等于部署 |
| 题库与美术 | 68道原创听读题、5类口语、22条官方资料；3主题、8幅原创图、19个外部参考；Web系统朗读、鸿蒙153段内置合成音频 | 待真人审校；没有正式分数标定或AI口语评分 |
| HarmonyOS | Windows SDK 26 编译、HarmonyOS 7 模拟器安装运行、学习/复习/打卡、下载目录实际导出；195项资源、153段离线音频，详见本轮QA记录 | 原生仍本机存储；真机签名/安装、真实录音音质和折叠屏硬件验收未完成 |
| Android/iOS | 当前源码树已删除工程、工作流、配置和依赖 | 历史报告和旧Git提交只用于追溯 |
| 栏目地图 | 五栏独立地图、统一状态栏、缩略图导航、场景行程卡；320/390/1440px 浏览器检查 | 使用用户素材派生图，来源见 art/MAP_LAYOUT.md；真机另验 |
| 数据基础 | schemaVersion=2、标记/任务的离线日志与服务端同步、幂等 JSON 备份恢复、追加式 SQL 迁移 | 错因/任务编辑和备份恢复界面仍未提供；录音备份无音频文件 |
| 验证 | 79项：54学习行为＋14鸿蒙源码/工具链＋6包体校验器＋5Web产物；类型/内容/素材、Web构建、195资源核对、SDK26 HAP编译通过 | 7cf83ef Core/Harmony CI通过，后续以最新PR头为准；旧全量Lint未通过；真机需单独验收 |
| 手机号认证 | RFC记录候选架构、真实前置、用户与Codex分工；readiness缺项会阻止通过 | 中国大陆短信需额外短信服务；AGC配置、令牌后端、费用与设备验收尚未到位 |
| GitHub流程 | Core、Harmony共享资源、源码预发布工作流，Issue/PR模板、CODEOWNERS | main分支保护和依赖问题仍由既有Issue跟踪，不假定设置已启用 |

在线地址：[微光托业](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)。手机使用系统浏览器并登录有权限的同一 ChatGPT 账号。本轮只构建和测试，未发布新 Site。Sites 与 GitHub 保留各自提交历史，发布记录单独核对，GitHub 合并不等于线上更新。

## 工程地图与验证

| 路径 | 职责 |
|---|---|
| `app/study-app.tsx`、`app/learn/` | Web/鸿蒙共享学习界面 |
| `lib/`、`app/api/`、`drizzle/` | 学习模型、本机存储/同步、身份边界、API及SQL迁移 |
| `content/`、`art/`、`public/` | 原创题库、外链目录、素材及来源 |
| `mobile/src/`、`mobile/vite.config.ts` | 鸿蒙共享Vite静态入口，读取根目录依赖 |
| `harmony/`、`lib/native-host.ts` | 鸿蒙Stage工程和生命周期桥 |
| `tests/`、`.github/workflows/` | 行为回归、资源检查、构建与发布 |

按改动风险运行，不重复无关全量检查：

```bash
npm run typecheck
npm run validate:content
npm run validate:art
npm run test:study
npm run build
node --test tests/*.test.mjs
npm --prefix harmony run sync:web
npm --prefix harmony run check:web
npm --prefix harmony run check:auth
node harmony/scripts/check-toolchain.mjs --report-only
```

`check:auth`仅报告前置，不会发送短信；`require:auth`缺配置时返回2。AGC配置路径为 `harmony/AppScope/resources/rawfile/agconnect-services.json`，不提交Git。HAP还需DevEco/SDK/OHPM/HDC、签名及设备；共享网页检查不能代替这些验收。配置和区域要求见 [RFC 0002](rfcs/0002-phone-auth-and-online-data.md)。

Windows 用 Node 24.13.1 和根目录锁定依赖。WSL 的 CLT 5.1.0.840 / SDK 5.1.0.125 / OpenJDK 21 构建基线继续保留，`harmony/scripts/build-offline.sh` 自动在 ASCII 临时目录构建并核对包体，见 [编译记录](testing/HARMONY_OFFLINE_BUILD.md)。2026-09-19 另已安装 Windows Studio 26.0.0.821、SDK 26.0.0.105、CLI 1.3.0 并完成 Huawei CLI 本人授权，HarmonyOS 7 模拟器已运行。Windows 构建在隔离 ASCII staging 中移除旧 compileSdkVersion 字段，由 Studio 使用所带 SDK，最低/目标 API 12 保持不变；未改仓库 API 18 编译基线。不要再把缺 SDK/模拟器或未登录当作当前阻塞。仍需真实手机连接和签名授权。

## 哪些已在GitHub，哪些不会随Git迁移

| 信息 | 位置与接续方式 |
|---|---|
| 源码、原创素材、题库、外链目录、SQL迁移、测试、需求决策与当前待办 | 仓库内；阅读本文件、RFC、路线图和状态文档即可接续 |
| Issues、PR讨论、提交与CI日志 | GitHub在线记录；并非普通git clone中的文件 |
| 这次聊天 | 未上传完整聊天；与开发有关的决定、状态及阻碍已整理进文档 |
| commit-work skill | 已安装到当前Codex个人环境；新环境不会自动继承，核心提交规范已记录于CONTRIBUTING.md |
| 学习记录与录音 | 生产D1/R2或设备localStorage/IndexedDB；不在Git。现有JSON导出不包含录音文件，迁移前另做音频备份 |
| 账号连接、托管身份、短信密钥、签名、AGC配置 | 外部平台或安全环境；不在Git，也不应公开提交 |
| SDK、依赖、生成网页资源、HAP | SDK不进Git；按文档重建，已有未签名HAP及校验报告保存在本机构建输出目录 |

因此GitHub足够接管源码开发，但不等于线上数据、外部权限、个人skill或手机环境已经搬迁。代码仓库公开，不放真实手机号、验证码、私密录音或密钥。

保留 `.openai/hosting.json` 及D1/R2绑定。已有Sites与GitHub源仓库历史不同，不强推统一历史；部署必须通过有权限的Sites环境同步、构建和发布。没有部署权限的Codex仍可开发和提交PR，不能声称代码push就更新了线上服务。

## 提交规范与后续任务

遵守 `CONTRIBUTING.md`：查看工作树和仓库约定、最少逻辑提交、明确文件暂存、检查差异和密钥、执行相关验证、PR记录真实边界。个人skill来源与固定版本见该文件；没安装skill也必须遵守仓库规范。

后续优先级：

1. 用户最新优先级是离线版及完整测试闭环。[#1 鸿蒙HAP](https://github.com/godnight/lantern-toeic/issues/1)、[#2 签名与备份](https://github.com/godnight/lantern-toeic/issues/2)：先读 [本轮QA记录](testing/HARMONY_QA_2026-09-19.md)，不要重做已通过项或把模拟器等同真机。用户已完成华为登录/实名并告知使用鸿蒙7以上手机；剩余真机连接、匹配签名材料和硬件验收。CLI 自动签名可能替换同团队证书，先检查并复用匹配材料，不能盲跑证书重建。
2. [RFC 0002](rfcs/0002-phone-auth-and-online-data.md)：手机号及联网版独立跟进，先确定号码地区、供应商和HTTPS认证后端。用户负责本人账号/认证/计费，Codex负责SDK、短信接口、令牌验证、数据隔离和测试。既有Site权限是否改为公开入口须另确认，不能因手机号登录而直接公开学习数据。
3. [#8 数据模型](https://github.com/godnight/lantern-toeic/issues/8) 本轮实现，先读 [RFC 0003](rfcs/0003-study-data-v2.md) 及关联 PR；继续 [#9 错因界面](https://github.com/godnight/lantern-toeic/issues/9)、[#10 每日计划](https://github.com/godnight/lantern-toeic/issues/10)。[#3 同步](https://github.com/godnight/lantern-toeic/issues/3) 已关闭，真实跨设备同步、下载及 PWA 验收继续跟踪 [#17](https://github.com/godnight/lantern-toeic/issues/17)。
4. [#4 依赖](https://github.com/godnight/lantern-toeic/issues/4)、[#5 仓库保护](https://github.com/godnight/lantern-toeic/issues/5)、[#6 内容审校](https://github.com/godnight/lantern-toeic/issues/6)：沿用现有追踪，不重复建单。

## 可直接交给Codex的任务

> 接续 godnight/lantern-toeic。先核对 test/harmony-offline-validation 的 PR，未合并从该分支接续，已合并从最新 main 开始。读取 AGENTS.md、本交接及 docs/testing/HARMONY_QA_2026-09-19.md。只维护 HarmonyOS 和 Web/PWA。Windows SDK 和鸿蒙7模拟器已运行，华为本人登录已完成；按证据继续剩余真机签名、硬件录音与持久化验收。手机号和云同步不阻塞离线开发。按 CONTRIBUTING.md 提交、验证和更新交接。
