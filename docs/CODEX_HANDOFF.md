# Codex 开发交接

**最新：v0.2.3美术**。共8幅原创图与两套ZIP；官方原作仅来源目录，不含图片本体。主题与素材独立版本管理。v0.2.2 PR #15及四类CI已完成；v0.2.3状态见同名发布与测试文档。

**最新接续提示（v0.2.2源码）：** 本轮新增独立美术库 `art/` 与共享素材浏览；同步问题可逐项处理，自动重试上限3次并持久化，33项行为回归通过。Issue #3 的核心修复已落地，合并/CI状态以GitHub为准。后续优先继续鸿蒙真实工具链、备份，以及 #8–#10 的v0.3数据与学习循环。下面的v0.2.1表格保留为历史交接基线，最新行为参见PROJECT_STATUS最上节。

更新：2026-09-08。代码主仓库为 [godnight/lantern-toeic](https://github.com/godnight/lantern-toeic)，开发从最新 `main` 创建任务分支。本文件负责传递项目上下文；仓库接入不会自动复制此前聊天、活跃代理或外部账号连接。

## 接入 Codex

在 Codex 的环境设置中选择本仓库，设置 Node.js 22（至少 22.13.0），初始化脚本填写：

```bash
bash scripts/codex-setup.sh
```

脚本安装根目录与 mobile 的锁定依赖，然后运行类型、内容及行为检查。它按自身位置定位仓库，没有固定工作区路径，也不需要生产凭据或模型 API Key。初始化阶段需要访问 npm 依赖源；无须为后续所有任务打开无限制网络。缓存环境如更换锁文件，可再次运行该命令。完整 Web 构建另需 GNU `timeout`，推荐 Linux 环境。

当前交接尚未在用户的 Codex cloud 环境实际启动；环境创建和仓库选择须在该界面完成。初始化脚本也被本仓库 Core CI 使用，可以查看 PR 的干净 Ubuntu 验证结果。

若使用桌面端或 CLI，克隆同一仓库，在该目录打开 Codex，再运行相同命令即可。桌面本地环境配置由应用设置界面生成，仓库未预造未知格式的环境配置。

官方接入依据（2026-09-08 核对）：[Codex cloud](https://learn.chatgpt.com/docs/cloud)、[云环境设置](https://learn.chatgpt.com/docs/environments/cloud-environment)、[桌面本地环境](https://learn.chatgpt.com/docs/environments/local-environment)。

## 当前可接续状态

用户目标：做面向中文用户的托业学习教练，提供网页与手机 App，可配置目标、时间和考试日期；优先鸿蒙手机，具体机型和系统版本待确认。视觉要求简洁、精致，使用深蓝遗迹、绯红丝境与明亮阅读主题。学习需要低门槛启动、真实反馈、错题复习和可积累的资料，不累计补课债。

| 项目 | 已完成 | 下一步或边界 |
|---|---|---|
| 版本 | [v0.2.1 源码预发布](https://github.com/godnight/lantern-toeic/releases/tag/v0.2.1)，PR #7 已合并 | 没有 HAP 附件；不要移动已有 tag |
| 网页 | 今日任务、练习解析、口语录音、复习、周复盘和资料书库 | 当前私有线上站点仍是 2026-09-07 发布的 v0.2.0；后续源码未自动部署 |
| 题库与美术 | 68 道原创听读题、5 类口语任务、4 张高清主题图 | 内容待真人审校；听力用系统朗读；没有正式分数标定或 AI 口语评分 |
| 官方集合 | 22 条：14 个样题/索引、6 个备考条目、2 个实际考题选题视频集合；含 4 个 ETS PDF 直链 | 第三方材料均为外链；未核实免费完整历届实际试卷 PDF；无转载权限声明 |
| 鸿蒙 | ArkTS/ArkUI/ArkWeb 工程，离线资源、前后台/权限/返回处理、录音保存保护 | 当前环境缺 DevEco/HarmonyOS SDK、hvigor、ohpm、hdc，未编译、签名或真机验证 HAP |
| Android/iOS | GitHub CI 的 debug APK 与 iOS 无签名模拟器编译通过 | 稳定签名、设备验收及完整备份待完成；原生尚为本机记录，无云端登录/同步 |
| 验证 | v0.2.1 的类型、内容、18 项实际源码行为回归、Web/mobile 构建通过 | 这些不等于鸿蒙 SDK 或真机验收 |
| GitHub 管理 | Core/三端工作流、贡献规则、Issue/PR 模板、CODEOWNERS、Dependabot、发布流程 | main 保护尚未启用；依赖仍有告警，见 #4/#5 |

上线地址：[私有微光托业](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)。源码 release、网页部署、可安装二进制与真机验收分别记录，不能互相代替。

## 阅读与工程地图

先读根目录 `AGENTS.md`，再读 `README.md`、`docs/PROJECT_STATUS.md`、`docs/TEAM.md`、`docs/MAINTENANCE.md`、`docs/PRODUCT_ROADMAP.md`。状态文档中的历史记录用于追溯，最新节优先。

| 路径 | 职责 |
|---|---|
| `app/study-app.tsx`、`app/learn/` | Web/移动端共享学习界面 |
| `lib/`、`app/api/`、`drizzle/` | 学习模型、本机存储/同步、服务端与 SQL 迁移 |
| `content/`、`public/` | 原创题库、官方入口目录与主题素材 |
| `mobile/` | Vite 静态入口、Capacitor Android/iOS 工程 |
| `harmony/`、`lib/native-host.ts` | 鸿蒙 Stage 工程及共享生命周期桥接 |
| `tests/`、`.github/workflows/` | 实际行为回归、构建与发布门禁 |

## 常用验证

首次运行初始化脚本；修改后按风险选择检查，不必重复安装：

```bash
npm run typecheck
npm run validate:content
npm run test:study
npm run build
npm --prefix mobile run build
npm --prefix harmony run sync:web
npm --prefix harmony run check:web
```

最后两项准备/校验鸿蒙共享资源，不编译 ArkTS 或生成 HAP。Android 另需 JDK 21/SDK 36，iOS 需 macOS/Xcode，鸿蒙需 DevEco/HarmonyOS 工具链及开发者签名。详见 `docs/NATIVE.md`、`harmony/README.md`。Core CI 还用 Python 3 对空 SQLite 执行迁移冒烟检查。

## 迁移边界与协作

Git 包含源码、素材、内容目录、SQL 迁移与团队职责；Issues/PR 讨论和检查记录保留在 GitHub，需要相应访问权限另行查看。线上 D1 学习记录、R2 录音、设备本机数据、私有网站身份、签名材料不会随 Git 被搬走。需要迁移部署或个人数据时另行制定备份与恢复方案，不能把它们提交到源码仓库。

保留 `.openai/hosting.json`、现有 Sites 插件及绑定。Web 构建可在普通 Linux 执行，生产身份与 D1/R2 接入仍依赖对应运行平台，不能伪造身份头来连接真实数据。若任务环境具备 Sites，遵守其技能及 checkout 所有者规则；缺少部署能力时可继续源码和静态构建，明确报告发布阻碍。

团队角色按 `docs/TEAM.md` 延续；每次任务按需创建代理，角色文档不代表进程永久常驻。互相独立的任务使用独立分支/工作树，集成负责人审查共享模型改动。已有 Sites 源仓库与 GitHub 的提交历史不同，文件树一致；新 Codex 任务以 GitHub main 为起点，勿强推来统一历史。

## 下一轮优先顺序

1. [#1 鸿蒙 HAP](https://github.com/godnight/lantern-toeic/issues/1)：核实 SDK 环境，完成真实编译、签名与设备录音/返回/前后台验收。缺工具链时保留阻碍证据，不把共享资源包写成可安装 App。
2. [#2 稳定签名与备份](https://github.com/godnight/lantern-toeic/issues/2)、[#3 同步可靠性](https://github.com/godnight/lantern-toeic/issues/3)：保护已学记录，处理永久错误及录音队列的有界重试。
3. [#8 数据模型](https://github.com/godnight/lantern-toeic/issues/8) → [#9 错因与存疑](https://github.com/godnight/lantern-toeic/issues/9)、[#10 可恢复每日计划](https://github.com/godnight/lantern-toeic/issues/10)：按 v0.3 路线推进；先设计迁移/导入导出/同步，不添加游离于数据体系的新 localStorage 状态。
4. [#4 依赖安全](https://github.com/godnight/lantern-toeic/issues/4)、[#5 仓库保护](https://github.com/godnight/lantern-toeic/issues/5)、[#6 内容审校与官方集合](https://github.com/godnight/lantern-toeic/issues/6)：维护已有追踪，避免重复建单。

每个可验收变更使用任务分支 → PR → 检查 → 审查 → 合并。版本发布遵循 `docs/MAINTENANCE.md`；只改交接/初始化说明时不修改 `release-manifest.json`，不生成重复版本。后续报告写明提交、验证、线上/安装状态和剩余阻碍。

## 第一条任务可直接粘贴

> 接续 godnight/lantern-toeic。先读取 AGENTS.md 和 docs/CODEX_HANDOFF.md，核对最新 main 与已有 Issues。优先推进 #1 鸿蒙 HAP 编译与验收，先检查真实工具链；若环境缺失，记录具体阻碍并继续 #3 数据同步可靠性。按已有产品定位和维护规范做成可审查的小步 PR，完成相关验证，更新状态；不要把源码/资源检查称为 HAP 编译或真机通过。
