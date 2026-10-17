# LANTERN · 微光托业

**围绕 TOEIC 备考，把练习、理解与复习连起来。**

微光是一个开源的托业学习项目，面向希望持续练习听力、阅读与口语的学习者，也欢迎开发者和内容贡献者一起改进。
我们希望你不只知道选哪个答案，还能理解依据、积累表达，再回到练习中巩固。

[学习者从这里开始](#给学习者) · [开发者快速开始](#给开发者) · [版本下载](https://github.com/godnight/lantern-toeic/releases) · [反馈问题](https://github.com/godnight/lantern-toeic/issues)

> 源码公开，产品仍在迭代；现有网站限制访问，尚不是人人可注册的正式服务。

## 给学习者

### 为什么使用微光

- **练完知道为什么。** 听读练习配合中文解析、答案依据与词汇；听力可继续逐句回听、听写，而不是只看对错。
- **把练习变成积累。** 错题与到期题优先复习，首答和复练分开记录，生词本与词卡帮助巩固表达。
- **从今天能做的一点开始。** 根据时间预算与已有 Part 表现安排少量练习，也保留 5 分钟起步方式。
- **开放共建，而非封闭题库。** 代码与项目自有原创练习采用开放许可，欢迎改进题目、解析、音频和学习体验。

### 可以怎样学习

1. **日常专项：** 从今日旅程或训练之境进入听读 Part 练习，作答后看解析，再做精听或复习。
2. **词汇巩固：** 在托业场景词库搜索中英文、收藏生词，通过词卡自测。
3. **整卷练习：** 导入自己有权使用的完整题包，完成计时听读模考并查看 Part 表现。项目不预装官方完整真题，见[题包导入说明](docs/EXAM_IMPORT.md)。
4. **口语练习：** 按任务计时练习，参考表达与自评清单；录音回听目前存在待解决问题，见下方说明。

主题提供深色、绯红与亮色选择。学习记录可按相应功能导出；普通学习记录备份不包含录音文件。

### 如何体验

| 方式 | 当前状态 |
| --- | --- |
| [网页 / PWA](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site) | 目前仅站点所有者可访问，使用托管的 ChatGPT 身份。 |
| [HarmonyOS 预发布包](https://github.com/godnight/lantern-toeic/releases/tag/v0.3.1) | 公开 HAP 为未签名开发产物，不是可直接安装的商店版；需对应开发工具链和签名。 |
| 从源码运行与构建 | 适合开发者，见下方快速开始；克隆代码不会自动获得生产网站身份或云资源。 |

当前维护 **Web/PWA 与 HarmonyOS**；不维护独立 Android/iOS 工程。
鸿蒙内置练习和词库支持本机使用，原生学习记录目前不与网页账号自动同步。

### 使用前请了解

- **录音尚未完成当前版本验收：** 鸿蒙模拟器录音内容过短、普通回听异常，由 [Issue #47](https://github.com/godnight/lantern-toeic/issues/47) 跟踪；旧版真机成功不代表新候选已修复。
- **不是官方考试评分：** 原创题未经真人教师完整校审或统计标定；正确率不等于正式分数，口语无 AI 自动评分。
- **声音仍有改进空间：** 现有语音为合成音，不是真人或官方音频；自然语音升级尚未发布。
- **公开账号体系仍待完成：** 公众多用户访问、独立登录及 +86 手机号登录尚未上线。
- **个人材料留在自己的设备：** 整卷题包与模考记录保存在当前浏览器/应用；请勿公开分享私人题包、录音或备份。

## 给开发者

### 快速开始

需要 **Node.js 22.13+、npm 和 Bash**；Windows 可使用 Git Bash。首次安装需要访问 npm 源。

```bash
git clone https://github.com/godnight/lantern-toeic.git
cd lantern-toeic
bash scripts/codex-setup.sh
npm run build
```

初始化会安装根目录锁定依赖并检查类型、内容、素材和学习行为；`mobile/` 无需另装依赖。Linux 构建还需 GNU `timeout`。

Web 使用 Vinext / Vite / Sites；生产身份与 D1/R2 需单独配置，构建成功不等于上线。环境与预览限制见 [Codex 交接说明](docs/CODEX_HANDOFF.md)。

准备鸿蒙共享网页资源：

```bash
npm --prefix harmony run sync:web
npm --prefix harmony run check:web
```

HAP 编译与签名还需 DevEco / HarmonyOS SDK 等工具，见[鸿蒙构建说明](harmony/README.md)；其中历史验收不能替代当前版本测试。

### 实现架构

**一套 React 学习界面与数据模型，分别承载 Web 和鸿蒙本机体验。**

| 层次 | 主要路径与职责 |
| --- | --- |
| 学习界面 | `app/study-app.tsx`、`app/learn/`：今日练习、听读、词库、口语、模考与复习。 |
| 学习与存储模型 | `lib/`：学习规则、数据版本、本机存储和同步；`content/`：版本化练习内容。 |
| Web 服务 | `app/api/`、`db/`、`drizzle/`：身份边界、API 与数据迁移；D1 保存学习数据，R2 保存录音。 |
| 鸿蒙容器 | `mobile/` 构建共享静态界面，`harmony/` 通过 ArkTS / ArkUI / ArkWeb 承载并处理原生能力。 |
| 验证与交付 | `tests/`、`scripts/`、`.github/workflows/`：行为回归、资源核对、构建与发布。 |

Web 只信任托管层提供的身份，原生当前采用本机存储；不要将网页会话、短信密钥或签名材料嵌入客户端。
详细数据流、离线边界及同步规则见[架构与数据](docs/ARCHITECTURE.md)。

### 验证与贡献

按改动风险执行对应检查，常用入口：

```bash
npm run typecheck
npm run validate:content
npm run test:study
npm test
```

从具体学习问题提 Issue，通过小范围 PR 改进。题目要有答案依据与干扰项说明，文本、图片、音频分别记录来源和许可。
不要提交私人数据或来源不明真题；PR 明确已验证及未验证的平台，不以单元测试代替真机验收。

[贡献指南](CONTRIBUTING.md) · [维护流程](docs/MAINTENANCE.md) · [产品路线图](docs/PRODUCT_ROADMAP.md) · [认证方案](docs/rfcs/0002-phone-auth-and-online-data.md)

路线图描述计划，不代表功能已经发布；GitHub 提交、Release 与网站部署也分别追踪。

## 许可与声明

- 软件代码采用 [MIT](LICENSE)。
- 项目拥有权利的原创练习文本按 [CC BY 4.0](LICENSE-CONTENT.md) 提供，具体范围以该文件为准。
- 第三方材料、图片、音频、依赖与商标保留各自权利；公开可查看不等于允许再分发。见[内容来源与审核规则](docs/CONTENT_SOURCES.md)。
- 微光是独立学习工具，与 ETS、IIBC 或 Team Cherry 无官方关联。
