# F04 日历日期一致性修复交接

2026-10-16 UTC。实现负责人小筑；小开统筹，dot 转独立小测。状态仅 **FIX_DELIVERED_PENDING_INDEPENDENT_REGRESSION**，不是独立 QA 关闭。

## 精确基线与范围

隔离源码候选 `vocab-work/f04-date-consistency-20261016/site`，分支 `fix/f04-study-calendar-date-20261016`，基线 `df567108fcb1fa25e95ea409c98b8908cc1db603`／tree `401bb1f6254b7390d3b39c37f17bbab5d15626e8`。最终提交、tree、逐文件 SHA、实际命令输出与负控由项目根 `项目组/engineering/F04-DATE-CONSISTENCY-20261016/ENTRY.json` 绑定。

仅修 profile.examDate／checkin.date 的新写入与普通备份日期一致性：

- API 两字段复用 `validStudyDate`。考试日期可空；学习日期不可空。非法请求400，原行不改。
- `useStudy.saveProfile` 在 journal／profile／setup 写入前拒绝非法日期；`addCheckin` 先确认同 ID 已持久的相同事实，仅在新事实 enqueue 前拒绝非法日期。
- writer 仍使用原 migration 输出，不把严格 reader 的字段投影拿来覆盖导出。只新增日期守卫和 `StudyBackupDateError`；旧非法值在普通下载前报错，不生成声称可恢复的普通备份。
- 资源页和记录备份页实际按钮共用导出处理；日期错误明确显示“无效日期／备份未生成／原记录未修改”，普通下载异常维持原泛化错误。成功仍提示用户确认文件已保存。

未改 `validStudyDate`、严格 reader、migrate、DB schema、身份验证、录音、评分／first 标签、请求体上限或 R2/D1 协调。没有日期纠正、历史清理、迁移脚本或新的恢复功能。

## 旧数据无损边界

旧非法 profile／checkin 仍按原路径读取，值、ID、事件时间、原 DB body 和本机存储不改。相同 ID 的旧本机持久事件仍可原样确认；新 ID 的非法事件拒绝。旧非法 pending 请求向服务端重传可能被400拒绝并继续保留，这不是已经修复或迁移了旧数据。

普通备份导出被日期守卫阻止时，两入口均提供可见错误；不归一化 `2026-02-31` 为3月，不跳过非法事件，不放松 strict reader。已经存在的非法备份仍被 strict reader 拒绝。原库与旧文件应原样保留，如何修正历史事实或提供法证导出另属后续合同，本次未实施。

## 开发验证与原版负控

仅已有依赖与隔离假数据；真实产品 API／crypto／SQLite `:memory:` 的 D1/R2 I/O 为适配器，本机 hook 与 UI 的 React／浏览器为夹具。没有真实浏览器、IDB、设备或服务端到端结论。

| 执行 | 实际结果与含义 |
| --- | --- |
| 原版 auth 的新日期测试 | 10项：4通过、6有效 RED，exit1。非法值200而应400、缺少导出错误、旧码新本机非法写入成功；不是加载错误 |
| 原版 auth 的双入口 UI 测试 | 8项：2通过、6有效 RED，exit1。保留普通下载／成功提示及未捕获异常的原行为，不回写为通过 |
| 完整修复日期闭环 | 10／10，exit0 |
| 完整修复双入口组件行为 | 8／8，exit0；含两入口各合法、旧 profile 非法、旧 checkin 非法和普通下载失败 |
| 既有相邻三文件回归 | 68／68，exit0：study-invariants、study-data-v2、phase2-study-idempotency |
| 既有账号隔离／Origin／owner／事件保护聚焦 | 5／5，exit0；不重验其余认证、密码或真实 TLS 范围 |
| TypeScript／diff检查 | `tsc --noEmit --incremental false`、`git diff --check` 均exit0 |

早期补丁字节替换遇 CRLF 差异，仅 API 修改完成时发生一次中间态测试：6通过、4失败、exit1。原记录 `FIX-FOCUSED-FIRST` 保留；完成其余实现后 `FIX-FOCUSED-COMPLETE-01` 才是10／10。未修改原测试断言或覆盖失败记录。

覆盖闰年1900／2000／2100、无效月日／格式、有效年界与月末、空考试日；合法 API 保存→GET→export→strict reader 闭合，合法旧 unversioned／v1／v2保持，旧非法 DB／本机原件及同 ID 确认无损。日历接受范围沿用既有 reader，包括既有四位年份语义，不新增业务年份限制。

## 小测复验入口

在独立新证据目录记录实际 argv／exit／stdout／stderr，核完整修复提交与源码 SHA；不得覆盖上述原件。使用已存在根依赖，不安装，不启真实网络服务。

```powershell
$env:LANTERN_REVIEW_ROOT='D:\zzl\托业学习\vocab-work\f04-date-consistency-20261016\site'
& 'C:\Program Files\nodejs\node.exe' --test --test-reporter=tap tests/f04-study-calendar-date.test.cjs tests/f04-study-backup-export-ui.test.cjs
```

cwd 必须为该候选 site；外层已留直接复验命令及源 pins。切到原版 auth 路径并执行候选中的同一测试文件可得到原版 RED；始终区分 source root 和测试文件位置。UI测试是实际 StudyWorkspace handler 的受控组件证据，不能写成真实浏览器点击验收。

## r20 和交付边界

冻结媒体 r20 `42ec27e8c6e41a04014e5a78a52befce7f97b1e7` 也有原 F04 行为，但本次未修改或移植。该树的媒体与账号存在分叉，后续整合需单独处理实际冲突；不得整包覆盖，也不得把本次修复状态外推到 r20 HAP。

这是源码候选，package0.3.6及既有 PUBLIC build identity 保留历史含义，没有新 Web/HAP。#47、REC-URL、F15、R-ROUTE-01／02、F05及TLS／救援／整合前置均未顺带关闭。未使用真实数据、设备、mic、凭据、证书／信任或生产服务，未上传、push、合入或部署。
