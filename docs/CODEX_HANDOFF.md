# Codex 开发交接

更新：2026-09-13。代码仓库：[godnight/lantern-toeic](https://github.com/godnight/lantern-toeic)。当前只维护Web/PWA和HarmonyOS；Android/iOS工程、专用工作流及Capacitor已删除，旧源码留在Git历史。

## 先选对分支

v0.2.4 的 [PR #18](https://github.com/godnight/lantern-toeic/pull/18) 已于 2026-09-13 合并，合并提交为 `9229c112737f3a69bfcd4eeab4dd7f3073e44bc7`。本轮 Issue #8 数据基础工作使用 `feat/study-data-v2`；接续时查看该分支的 PR 状态：

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
| 在线版本 | 原私有 Site 地址及 custom/owner 权限保持；发布前已核实第 4 版成功 | 本轮版本以 Sites 实际部署状态及 PR 交付记录为准，GitHub 合并不等于部署 |
| 题库与美术 | 68道原创听读题、5类口语、22条官方资料；3主题、8幅原创图、19个外部参考 | 待真人审校；听力用系统朗读；没有正式分数标定或AI口语评分 |
| HarmonyOS | ArkTS/ArkUI/ArkWeb工程、联网声明、本地资源、录音/权限/前后台/返回桥 | 原生仍本机存储；未生成、签名或真机验证HAP |
| Android/iOS | 当前源码树已删除工程、工作流、配置和依赖 | 历史报告和旧Git提交只用于追溯 |
| 数据基础 | schemaVersion=2、标记/任务的离线日志与服务端同步、幂等 JSON 备份恢复、追加式 SQL 迁移 | 错因/任务编辑和备份恢复界面仍未提供；录音备份无音频文件 |
| 验证 | 数据基础本地类型、43 项行为回归、Web 构建、5 项产物检查、鸿蒙共享构建及 23 项资源核对通过 | CI 最终结论见 PR；旧全量 Lint 未通过；手机设备需单独验收 |
| 手机号认证 | RFC记录候选架构、真实前置、用户与Codex分工；readiness缺项会阻止通过 | 中国大陆短信需额外短信服务；AGC配置、令牌后端、费用与设备验收尚未到位 |
| GitHub流程 | Core、Harmony共享资源、源码预发布工作流，Issue/PR模板、CODEOWNERS | main分支保护和依赖问题仍由既有Issue跟踪，不假定设置已启用 |

在线地址：[微光托业](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)。手机使用系统浏览器并登录有权限的同一 ChatGPT 账号。Site 第 4 版的历史源提交为 `7170d31e67795951d1d35e64427a6d611c670a74`；本轮先同步 PR #18，再实现数据基础。Sites 与 GitHub 保留各自提交历史，发布记录单独核对。

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

Windows 本轮用 Node 24.13.1、`npm ci` 安装锁定依赖，通过 Git Bash 执行现有 `scripts/build-verified.sh` 完成 Web 构建；无需改写项目构建脚本。当前机器未找到 DevEco、SDK、OHPM、HDC 和 Java，没有生成 HAP。

## 哪些已在GitHub，哪些不会随Git迁移

| 信息 | 位置与接续方式 |
|---|---|
| 源码、原创素材、题库、外链目录、SQL迁移、测试、需求决策与当前待办 | 仓库内；阅读本文件、RFC、路线图和状态文档即可接续 |
| Issues、PR讨论、提交与CI日志 | GitHub在线记录；并非普通git clone中的文件 |
| 这次聊天 | 未上传完整聊天；与开发有关的决定、状态及阻碍已整理进文档 |
| commit-work skill | 已安装到当前Codex个人环境；新环境不会自动继承，核心提交规范已记录于CONTRIBUTING.md |
| 学习记录与录音 | 生产D1/R2或设备localStorage/IndexedDB；不在Git。现有JSON导出不包含录音文件，迁移前另做音频备份 |
| 账号连接、托管身份、短信密钥、签名、AGC配置 | 外部平台或安全环境；不在Git，也不应公开提交 |
| SDK、依赖、生成网页资源、HAP | 按锁文件和脚本在目标环境重建；当前尚无HAP |

因此GitHub足够接管源码开发，但不等于线上数据、外部权限、个人skill或手机环境已经搬迁。代码仓库公开，不放真实手机号、验证码、私密录音或密钥。

保留 `.openai/hosting.json` 及D1/R2绑定。已有Sites与GitHub源仓库历史不同，不强推统一历史；部署必须通过有权限的Sites环境同步、构建和发布。没有部署权限的Codex仍可开发和提交PR，不能声称代码push就更新了线上服务。

## 提交规范与后续任务

遵守 `CONTRIBUTING.md`：查看工作树和仓库约定、最少逻辑提交、明确文件暂存、检查差异和密钥、执行相关验证、PR记录真实边界。个人skill来源与固定版本见该文件；没安装skill也必须遵守仓库规范。

后续优先级：

1. [RFC 0002](rfcs/0002-phone-auth-and-online-data.md)：先确定号码地区、供应商和HTTPS认证后端；用户负责本人账号/认证/计费/设备授权，Codex负责SDK、短信接口、令牌验证、数据隔离和测试。既有Site权限是否改为公开入口须另确认，不能因手机号登录而直接公开学习数据。
2. [#1 鸿蒙HAP](https://github.com/godnight/lantern-toeic/issues/1)、[#2 签名与备份](https://github.com/godnight/lantern-toeic/issues/2)：获取可用工具链并完成编译、签名、覆盖升级与真机验收。
3. [#8 数据模型](https://github.com/godnight/lantern-toeic/issues/8) 本轮实现，先读 [RFC 0003](rfcs/0003-study-data-v2.md) 及关联 PR；继续 [#9 错因界面](https://github.com/godnight/lantern-toeic/issues/9)、[#10 每日计划](https://github.com/godnight/lantern-toeic/issues/10)。[#3 同步](https://github.com/godnight/lantern-toeic/issues/3) 已关闭，真实跨设备同步、下载及 PWA 验收继续跟踪 [#17](https://github.com/godnight/lantern-toeic/issues/17)。
4. [#4 依赖](https://github.com/godnight/lantern-toeic/issues/4)、[#5 仓库保护](https://github.com/godnight/lantern-toeic/issues/5)、[#6 内容审校](https://github.com/godnight/lantern-toeic/issues/6)：沿用现有追踪，不重复建单。

## 可直接交给Codex的任务

> 接续 godnight/lantern-toeic。PR #18 已合并；先核对 feat/study-data-v2 的 PR，未合并从该分支接续，已合并从最新 main 开始。读取 AGENTS.md、docs/CODEX_HANDOFF.md 及 docs/rfcs/。只维护 HarmonyOS 和 Web/PWA。数据基础已实现，继续错因/计划界面时复用现有操作日志、版本合并及 API，不重做迁移。手机号认证与 HAP 仍需真实服务和工具链。按 CONTRIBUTING.md 提交、验证和更新交接。
