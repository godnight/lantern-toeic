# 第二阶段合成保存／升级／恢复夹具

此目录全部是 **SYNTHETIC QA**。没有用户记录、私人题包、音频、签名或凭据；不能作为真实学习历史导入日常 App。生成器仅使用内存 `fake-indexeddb`，从实际目录读取词条／题目，通过真实 `VocabularyWorkflow`、`PracticeWorkflow` 和仓储生成数据；不手改备份 scope、不修改业务实现。

在项目根执行（已有依赖，不安装）：

```powershell
node examples/phase2/generate.cjs
node examples/phase2/generate.cjs --verify
```

`--verify` 重新用真实服务生成并逐字节比较本目录制品，检查配套 legacy 引用、缺引用阻止完成、prepared 不自动执行、重复恢复新增 0、明确重试保留原 ID／时间／payload、同会话确认两次只新增一次 Checkin。它不是浏览器、升级、SDK 或模拟器验收。源码改变后需重新生成，`SOURCE-MANIFEST.json` 绑定实际读取的源码和 catalog；不能把旧夹具验证套在后续源码上。固定合成时钟为 2026-10-14 08:00 UTC 起，时区 Asia/Shanghai；所有动作 UUID 由作用域代码＋计数器确定。

## 文件及预期

三份目录分别为 `harmony-device/`、`web-local/`、`web-owner/`。各自通过真实服务独立生成；owner 仅为 `synthetic-phase2-qa`。跨 scope 正常恢复应拒绝，不能编辑 JSON 改 scope 绕过。

| 每个 scope 的文件 | 用途 |
|---|---|
| `legacy-study-snapshot.json` | 旧 schema2 主快照外壳 `{data:StudyData}`；用于新隔离 context 的受控 seed，不是正常 UI 导入文件 |
| `legacy-study-backup.json` | 旧独立学习备份：同题首答＋复练、9 分钟 Checkin；无录音 Blob |
| `legacy-vocabulary-backup.json` | 独立 schema1 词卡备份：实际词条、取消收藏 revision2、一个 `synthetic-missing-word` 未知旧 ID；未知 ID 故意保留，不造词文 |
| `workflow.json` | 正常 workflow-v1：真实词计划，2 个新词持久反馈，1 个 prepared 未应用反馈；完整真实对话／文章题组已完成，7 分钟结算仍是 draft |
| `workflow-study-backup.json` | workflow 所需的旧 Study 事实，含基线＋已写 Practice Attempt。未确认的 7 分钟不产生 Checkin |
| `workflow-study-snapshot.json` | 上述配套事实的真实主快照外壳，仅用于隔离测试 seed，不能报告为 UI 学习备份恢复 |
| `workflow-vocabulary-backup.json` | workflow 所需的旧词卡事实，含基线＋2 个新反馈；prepared 的事件尚不存在 |
| `expected.json` | 合成标识、精确 key、真实内容 ID、计数、prepared ID、待确认 Checkin ID、生成器恢复验证结果；不是可导入备份 |

`FIXTURE-INDEX.json` 是总入口；`MANIFEST.json` 和 `SHA256SUMS.txt` 给文件字节与 SHA-256。清单不含自身 hash 循环；SHA256SUMS 也不自含。词条／题目正文来自现有 catalog，不重写其内容或许可。

## 精确存储边界

| scope | 旧 Study 主 key | 旧词卡 seed key |
|---|---|---|
| harmony-device | `lantern-v1-device` | `lantern-vocab-v1:device:synthetic-phase2-seed` |
| web-local | `lantern-v1-device` | `lantern-vocab-v1:device:synthetic-phase2-seed` |
| web-owner synthetic-phase2-qa | `lantern-v1-synthetic-phase2-qa` | `lantern-vocab-v1:owner:synthetic-phase2-qa:synthetic-phase2-seed` |

旧词卡读取按此前缀合并；表中只是这份合成 seed 的一个独立 journal 键。新库为 `lantern-workflow-v1` / version1，各 row 的联合 key 为 `[scopeKey,id]`。`scopeKey` 是整个 scope 的稳定编码，见每份 `expected.json`。Web 与鸿蒙 device 的旧 key 名相同，**必须在不同隔离 origin／存储上下文中验，不能混在同一 origin**。未来 schema／坏字节不得降级覆盖。所有夹具无 Exam 数据；不得对私人题包或音频库做 seed。

## 独立 Web context 的测试 seed

Study 当前有导出而没有正常恢复 UI。使用 `seed-isolated-context.cjs` 是**测试初始化路径**，不能报告为学习 JSON UI 恢复通过。该 helper 不启动浏览器、不选目标；只有小测已建立的新 BrowserContext 可显式调用。它要求独立 loopback 端口，拒绝覆盖非空 localStorage，seed 之后不重复改写。

```js
// 由 QA 已有浏览器脚本调用；QA_PORT 是其新建隔离产品服务的明确端口。
const {installSyntheticSeed} = require('./examples/phase2/seed-isolated-context.cjs');
const context = await browser.newContext(); // 不复用个人 profile / 线上 origin
await installSyntheticSeed(context, {
  origin: `http://127.0.0.1:${QA_PORT}`,
  scenario: 'web-local',
  mode: 'matching-workflow',
});
// 随后才首次导航到 QA 的真实产品入口；本目录脚本不代为导航或导入。
```

模式：`legacy-only` 用于先保存旧版合成基线；`matching-workflow` 在首次导航前 seed 配套旧 Study／词卡事实；`missing-references` 只 seed 空旧事实以验证缺引用。helper 不 seed 新 workflow IDB，必须通过正常工作流 UI 导入。Web-owner 必须由受控 QA 入口实际提供合成 owner；不能靠 localStorage 或编辑备份冒充已认证身份。浏览器 nativeMode 替身只是 Harmony 逻辑 scope，不能算 ArkWeb 验收。

## 正常 UI 导入／恢复顺序

1. 小测建立新的隔离产品 origin／BrowserContext，选与实际入口一致的 scope。需 Study 配套引用时，首次导航前用上面的 **matching-workflow 测试 seed**；不要在已运行的 App 中改主 key。独立 native 实例的初始化由小测自行安排，本目录不提供设备写入脚本。
2. 词卡正常文件导入入口：单词页 → “浏览全部词条、旧词卡与收藏备份” → “词库来源与记录备份” → “导入词库记录”，选同 scope `workflow-vocabulary-backup.json`。重复导入只按原 ID 合并，取消收藏和未知词事件保留。查词页亦复用相同备份组件。
3. 工作流正常入口：单词计划页 → “把计划留在自己手里” → “恢复工作流备份”，选同 scope `workflow.json`。只导入此文件不能替代旧 Study／词卡事实；缺失时应标 `reference-unverified`／引用缺失，不能揭义、计完成或补写事实。导入后再次选择同一文件应新增 0。
4. 匹配引用后检查 `expected.json`：**固定 2026-10-14／Asia/Shanghai 日 ledger** 新学 2，第三反馈仍 prepared，普通组完成、结算 7 分钟仍 draft，总 Checkin 分钟仍为旧 9 分钟。只有用户在隔离测试中明确重试原反馈或确认时间后才执行；明确确认两次只新增一次 7 分钟 Checkin，不加逐题秒数。若实际 UI 的本地日期已不同，不要求运行当天显示新学 2；核固定历史 ledger 与运行当日应分别记录，不改宿主时钟冒充当天。

## 带数据升级与故障样本

带数据升级需小测在**新自有隔离模拟器／实例**先用旧包形成并导出合成基线，核对本目录 ID／时间／内容，再在同一隔离目标 preserve-data 升级第二阶段包并正常导出比较。Node 的合成服务恢复检查没有执行安装或升级，不能替代它。现有用户手机、现有真实学习分区及既有私包实例均不在此流程中。

`faults/` 三项单独标为 **不可正常导入**：坏主快照是故意截断的 `.txt`；`future-study-schema.json` 是 schema999 主快照；`future-workflow-schema.json` 是未来新域版本。只在另开的全新故障 context 使用。helper 仅对 `web-local + legacy-only` 接受 `fault:'bad-main'` 或 `'future-study'`，检查原字节保留／只读阻止后结束该 context，不清数据“修复”。未来工作流文件只用来验证拒绝，不混入正常 fixture。

本包交付时只执行生成器及自身验证；浏览器正常文件选择、原生导出、重启、带数据升级、Back／后台、HAP 指纹均由小测另行留证。
