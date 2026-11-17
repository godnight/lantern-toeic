# 微光托业架构评审归档

**2026-10-13，文档评审完成；生产整改未执行。** 本归档以现场最新实现为基线，覆盖共享Web/Harmony、数据/安全、查词、学习与模考、导入/云题包、主题、构建/测试/发布。各结论有文件/符号/行号或可重复的合成证据，并区分已实现、接口已有、后续计划和历史验收。

## 阅读索引

| 文件 | 用途 |
|---|---|
| [CURRENT_ARCHITECTURE](CURRENT_ARCHITECTURE.md) | 当前模块职责、依赖/数据流、存储/同步/备份、身份和原生边界、实现状态 |
| [FINDINGS](FINDINGS.md) | 18项证据问题、影响/触发限制、优先级和处置门槛 |
| [TARGET_AND_PLAN](TARGET_AND_PLAN.md) | 目标边界、S0–S5渐进整理建议与后续小版本交付标准 |
| [VALIDATION_AND_ROLLBACK](VALIDATION_AND_ROLLBACK.md) | 逐领域回归、迁移前后字段比较、停止/回滚及本轮验证范围 |
| [REVIEW_RECORD](REVIEW_RECORD.md) | 三项实际独立评审、分歧/回应/最终采用结论、协调和用户保护 |
| [UI_ALIGNMENT](UI_ALIGNMENT.md) | 给并行全页面/四主题/搜索重设计的可实现约束 |
| [reviewers](reviewers/README.md) | 三份独立原稿及其真实执行范围 |
| [evidence](evidence/README.md) | 脱敏复现脚本、输出、测试日志摘要和基线/文档校验证据 |

## 基线与接续背景

| 对象 | 本轮核实 |
|---|---|
| 工作区根目录 | `D:\zzl\托业学习`不是Git根；包含历史交付与多个checkout |
| 本次审查/归档checkout | `vocab-work/theme-redesign-20261012/site`，分支main，HEAD `12317b26b85a71888760b0cc18242d00a843ac74`，树 `8653fe5f8ff54651d038105ba67d1ba39bab9cc8`；初始干净 |
| 旧主目录checkout | `lantern-site`，`feat/dictionary-expansion` / `70b0d6bdb08a717aa1ca2c123c5721ed705d9f69`；初始干净，不能当最新现状。该仓库worktree清单只有自身，最新site是另一个独立checkout |
| GitHub PR链（只读实时元数据） | [#42](https://github.com/godnight/lantern-toeic/pull/42) `feat/dictionary-expansion`→main，head c64f8c61；[#43](https://github.com/godnight/lantern-toeic/pull/43) `feat/private-exam-library`→词库分支，head 06649028；[#45](https://github.com/godnight/lantern-toeic/pull/45) `feat/companion-themes`→私库分支，head af779e59。三项均open/未合并，不能从GitHub main假定全功能 |
| Sites现有发布 | 只读确认保存版本18/source=12317b2；该版本部署状态succeeded，保留现网址。当前访问custom、允许用户1/组0；没有本轮权限变更或发布。#45描述声明其树与本site树一致，本轮没有重新fetch整份GitHub树验证 |
| 原任务继承 | 受支持`list_threads/read_thread`找到「托业鸿蒙app迭代」01a09915-1155-7f52-8bc3-8d1d6b81081e；初次读失败，重试成功。最终历史确认v0.3.3原生本机记录、题包云库下载路径与未合并PR。完整私有聊天不复制入仓库 |
| 并行任务 | 「重设计微光托业界面」01a13332-d125-77c8-a819-3b7eaeeb2039 active；原「托业鸿蒙app迭代」idle，「主题图像」「真题跟踪」notLoaded。没有停止/改变任何其他任务。UI产物使用独立目录，归档仅本目录 |
| 本地规则/记忆 | 已读此checkout AGENTS、README、PROJECT_STATUS、TEAM、CODEX_HANDOFF和相关RFC。当前工作区/相关祖先未找到可用`.agents/skills`规则；必要历史由受支持任务摘要和根目录2026-09-13接续文档补齐。Personal Context技能读入后检索返回当前会话不可用，未假称读取到额外记忆 |

这里的main是Sites本地历史，与GitHub main不是同一HEAD。safe.directory只通过每次Git命令参数临时指定，没有修改全局Git配置。本轮未checkout/reset/clean、不新建分支、不执行安装、不触及签名/凭据或真实用户数据。

## 关键发现

坏主snapshot可能静默降为空并被后续写覆盖；音频abort-only缺终态；授权录音同ID请求有D1/R2幂等缺口。均是合成复现，未证明当前用户已损失数据或发生跨账号读取。录音冲突普通UI触发未证实，最终采用P2并保留相关变更前必修门禁；坏快照/abort采用P1。

Web学习/词库账号同步、原生本机保存、模考本机历史和云题包文件取回有不同能力。旧架构的“模考计划中”过时，而错因/资源任务/学习JSON恢复仍只到模型/API/hook。四套无IP日/夜+空洞骑士+丝之歌是本轮新目标，现行四IP配色/固定场景未满足；需要完整根token、素材policy和旧Theme兼容。

## 交付及限制

335项学习回归、类型、内容/素材结构和脱敏探针完成；生产源文件保护、归档链接/路径/证据检查见 `evidence/archive-validation.json`。独立代理额外测试为重叠范围，分开记录。外链reachability在受限环境23项TypeError，不能声称全部链接失效。

未执行生产重构/迁移/数据清理、发布/推送/合并、构建/SDK/签名/真机操作或真人内容审校；当前实现和计划只写入此归档。下一步是把S1可靠性建议报给负责人，再按审定范围做小版本；完整归档本身无阻塞。
