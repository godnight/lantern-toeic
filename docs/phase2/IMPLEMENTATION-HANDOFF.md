# 第二阶段实现交接 · P2-20261014-r1

状态：开发实现及本地验证完成，交独立 QA；没有 push、合入、部署、签名或设备安装。

- 分支：`feat/phase2-learning-20261014`。此独立工作区承接保留提交 `99ca13fc2a68bb7ef468db930b9fbfdd7be9736f`；没有改原 checkout 或冻结 Demo。
- buildId：`P2-20261014-r1-2c3061fdf74b`，版本 `0.3.4 / 20010`。
- 实际源输入：1,363 项，SHA-256 `2c3061fdf74b8b0ea8a4aeae1e6293b1f277a1ea779d7ad0d1764c66776df4cf`。`public/build-identity.json` 自身排除在递归计算之外；完整输入清单保存在工作区外层 `source-freezes/P2-20261014-r1/runtime-inputs.json`。
- HAP：外层 `tooling/builds/build-lantern-phase2-0w883ffp/lantern-phase2-unsigned-local-only.hap`，46,430,052 字节，SHA-256 `0a9d2760ddf6b52d06df95aa243bd14826b1dcbd90eaf719535a4406b5605e0d`。SDK 26.0.0.105 实际构建，最低／目标 API12，unsigned；1,091 项共享 Web 资源及图标、identity 逐字节核验通过。

## 运行与核对

使用既有根依赖，不要在共享 `node_modules` junction 上重新安装。本机 Node 为 `C:\Program Files\nodejs\node.exe`（24.13.1），Python 为 `C:\Program Files\Python311\python.exe`（3.11.9）。新机器按锁文件配置依赖，不能照搬本机 junction 路径。

```powershell
& 'C:\Program Files\Python311\python.exe' -S -B scripts/freeze-workflow-build.py --check --freeze-id P2-20261014-r1
& 'C:\Program Files\nodejs\node.exe' --test tests/*.test.cjs
& 'C:\Program Files\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit --incremental false
& 'C:\Program Files\nodejs\node.exe' scripts/build-verified.mjs
& 'C:\Program Files\nodejs\node.exe' --test tests/*.test.mjs
```

现有构建日志在外层 `dev-validation/`。开发浏览器脚本 `tests/browser/phase2-workflow.cjs` 会建立新 context、自有 localhost 服务和合成记录，外部请求被阻止；执行前设置 `PHASE2_EXPECT_BUILD_ID` 为以上完整 ID。不得把它指向旧浏览器配置或生产站点。开发最终报告在外层 `dev-browser/2026-10-14T16-32-22.407Z-11a5b74d/`。这是浏览器 nativeMode 夹具，不能代替 Web 真实认证／D1、ArkWeb 或设备验收。

## 接口与保存边界

`lib/learning-domain-repository.ts` 在独立 `lantern-workflow-v1` / IDB version1 中按完整 scope 隔离。计划／词汇状态由单个根 `useVocabularyWorkflow` 投影至今日、计划和候选；普通练习由 `usePracticeWorkflow` 管理固定 queue、cursor、Attempt、记时草稿和 Checkin ID。旧词卡和 Study journals 仍是学习事实权威。prepare 预留完整原始事件，旧 adapter 保存后再鲜读同 ID／规范内容，然后 apply；跨 IDB 与旧存储没有原子事务承诺。

新词与复习分别计数；三档自评保留原值，认识映射 remembered，模糊／忘记映射 again。当天未开始组采用新计划，活动组保持原窗口与队列；加入候选、查询、收藏、发音、揭义不生成完成数。继续组目标题数默认为5，完整题组可超过；耗尽明确提示，复练须显式选择。每组只由用户确认一次分钟，逐题 seconds 和词卡不另加分钟。

新备份为 `kind=lantern-workflow/schemaVersion=1`，文件名固定 `lantern-workflow-backup.json`，同时覆盖单词和普通练习工作流。旧 Study2、词卡1、模考仍独立备份。导入先整包验证再事务合并，prepared 不自动执行，缺旧事实引用不显示已完成；显式重试沿用原 payload／时间。坏记录、未来版本、存储不可用均阻止相关写入并保留原数据；重读按钮可显式重新打开数据库。合成输入及说明见 `examples/phase2/`。

## 开发结果与后续

开发 CJS 643/643、构建后 MJS 34/34、原生 helper 16/16 通过；类型、内容结构、Web 构建通过。浏览器最终 11 个流程及零错误检查 12/12 通过：11 Attempts、一个7分钟 Checkin、另一组未确认草稿仍在；22张截图实际覆盖两主题320/DPR2、430/DPR3，无横向溢出。各范围分列，不能相加冒充全产品或设备验收。

构建警告保留：主 chunk 超过500kB、Node punycode 弃用；尚无真实目标设备性能证据。旧云录音 D1/R2 幂等 F01 不在本期整改内；真实媒体、系统文件选择器、OS Back／前后台、无障碍、Web owner 网关、私包模考和真机均按独立测试实际结果报告。免费音源仅交 [本地方案](FREE-LOCAL-AUDIO-PLAN.md)，没有新样音试听或全库替换。默认夜间、丝之歌新稿和文字图标后续。

本包仅交指定独立模拟器验收。独立 QA 完成前不 push；之后核对 GitHub 实际 remote、功能分支、远端历史与 CI／外部自动部署行为再推已验版本。不能直接把 Sites 的本地历史推到 GitHub main，也不能自动合入或触发上线。
