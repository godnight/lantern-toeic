# 如何维护微光托业

维护目标是让每次改动可追溯、每次保存可信、学习材料可持续使用。仓库代码公开，学习记录与录音不进入仓库。

## 一次改动的完整流程

1. **Issue 定义问题。** 写实际影响、复现或学习用途、优先级、验收条件。一个 Issue 尽量对应一个可验收结果。
2. **短分支实现。** 使用 `fix/…`、`feat/…`、`content/…` 或 `chore/…`，保留已有题号与学习数据兼容性。
3. **PR 说明行为和证据。** 使用模板，代码与内容都要审查；独立代理可以提供审查记录，但不能冒充另一个 GitHub 用户的审批。
4. **检查当前提交。** `Core validation / core-validation` 覆盖类型、内容、实际学习行为、Web构建和空库迁移。鸿蒙改动额外看共享资源结果；共享资源检查不代表HAP编译。Android/iOS为归档目标，不再要求自动门禁。
5. **合并并记录版本。** 检查无未解决阻断项后合并，更新状态与变更记录。发布要记录源码SHA、构建URL、校验和和验收平台；包体通过不等于录音和升级通过。
6. **发现回退就修正或回退。** 数据库与数据格式改动先准备兼容路径；不以卸载应用解决用户数据迁移问题。

## 轻量维护节奏

| 时机 | 做什么 | 产出 |
|---|---|---|
| 每个PR | 代码/内容审查、相关检查、确认保存与许可边界 | 可复核PR |
| 每周 | 筛选Issues和Dependabot更新，复查失效资源 | 下一批小任务 |
| 每次原生交付 | 安装、录音、后台、离线、旧包覆盖升级 | 设备型号与系统版本的验收记录 |
| 每月或考试规则变化后 | 核对官方题型/链接、清理过时文档 | 资料核验日期与变更记录 |
| 发布时 | 核对锁文件、签名指纹、产物哈希、已知限制 | 可追溯发布说明 |

这些是维护规则，不代表子代理或人工审查在后台持续运行。Dependabot配置负责提出更新；仍需审查后合并。

## GitHub管理状态

2026-09-08已读取仓库：公开，默认分支main，Issues已开；当时没有开放Issue/PR，main的 `protected=false`，rulesets为空。新增文件不会自动开启分支保护。

当前连接提供代码/Issue/PR操作，但没有修改仓库管理设置的接口。以下应由拥有设置权限的维护者在 [仓库规则设置](https://github.com/godnight/lantern-toeic/settings/rules) 完成：

- main禁止强推和删除，要求通过PR合入，并要求 `core-validation` 检查。
- 当前只有单个真实维护账号，先不要设置“必须另一个人批准”，以免自有PR无法满足；有第二名维护者后再要求至少一名独立批准。
- 检查Secret scanning、Dependabot alerts及私密漏洞报告是否启用；未读取到的开关不记为已启用。

[GitHub分支保护说明](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)与[代码所有者说明](https://docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)解释这些设置。CODEOWNERS是责任归属，不等于已启用审批门禁。

## 资料集合怎么维护

主数据在 [content/exams/catalogue.json](../content/exams/catalogue.json)，说明在 [官方考试资料集合](../content/exams/README.md)。App直接读取同一份数据，避免再维护一套手工清单。

每项记录官方来源、样题/实际考题/备考分类、范围、格式、是否收费、下载链接、核验日期和使用范围。实际考题选题视频不能标为完整历年卷；公开下载只给官方链接，不自动转存到GitHub。未获转载许可的材料保持 `link-only`。

新增资料先核对原站及具体附件，执行 `npm run validate:content`。每月可运行 `npm run check:resources` 生成链接检测报告；HTTP可达不代表视频能播、链接内容未换或已获转载授权，仍需人工核验。链接失效先保留条目和问题记录，再替换来源；已关联学习记录的ID不随意改名。

## 版本管理

- 版本采用 `MAJOR.MINOR.PATCH`：兼容修复更新PATCH；新增学习功能更新MINOR；破坏数据兼容时再考虑MAJOR。原生工程另有单调递增的构建号。
- `release-manifest.json` 是本次准备发布的源码版本声明；根、共享网页构建包与harmony版本和发布说明必须一致。归档Android/iOS构建号冻结在v0.2.3。
- 只有main上的版本声明变更会触发Source preview release：先在只读权限job验证源码，再以独立的contents:write job创建源码预发布与固定tag。此工作流不发布App商店、不部署Site、不上传假HAP。
- tag不可移动或覆盖。已有同名tag指向不同提交时工作流失败，应修正并使用新版本号。v0.2.1先作为源码预览，后续功能在独立PR推进。
- APK/HAP签名与真机状态独立记录；源码预发布不提升为“已可安装的鸿蒙版本”。

CI首次运行已暴露并修正环境差异：根typecheck及鸿蒙共享资源构建仍读取`mobile/`中的历史命名构建入口，因此Core工作流暂时安装根和mobile两份锁定依赖；这不表示Android/iOS仍受支持。
