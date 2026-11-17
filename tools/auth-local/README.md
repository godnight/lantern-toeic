# 账号测试环境：离线准备与原位升级

本入口复用现有账号 API、workerd/D1、scrypt 和 `drizzle` 增量迁移。没有新账号服务、远端部署器、证书或依赖。本分支仍为 **0.4.6 / 20062**，未构建新二进制、未部署或安装。仅认证准备工具改变；原业务与设备验收不由本页放行。

## 当前真实状态

**NOT_READY**：独立测试项目、所属平台账号、实际 D1 ID/独占关系、实际受信 HTTPS hostname 与 DB 绑定的只读证据均缺。默认建议使用平台自带 HTTPS 地址，不需要购买域名；精确 origin 只能来自获准创建后的平台结果。

`.openai/hosting.json` 只有 project_id/d1/r2；现 project 为 `appgprj_6a9e270c912c8191b5983b0f4cb42089`，DB/BUCKET只是绑定名称，不是远端数据库身份。此文件保持原样，不能复制为测试目标。现站 owner-only，不能修改现站权限来替代独立环境，更不能将管理token塞进App。

项目负责人本轮核过的实际平台能力：Sites由平台 provision/connect 绑定资源；`create_site` 只回 project id/expected_url，不回CF account或物理D1 ID；`read_database_overview` 只回项目/绑定/表名，不回物理DB ID。本准备器当前要求的账号/物理库禁集证据超出现有这些入口的输出，故**真实目标仍NOT_READY，不能要求用户寻找这些工具不提供的字段**。未来可另行评估已批准新项目的项目绑定资源证明与平台隔离保证，再审安全合同；本轮不把binding/test标记代替物理身份，也不新增资源/数据库读取。

**另一个独立阻断是部署输入**：当前 `worker/index.ts` 和普通 Sites 构建承载完整应用，尚无已核可发布的 auth-only 最小包。未来只允许已有注册/登录/session(v2)/退出及其必要代码/测试 DB；学习、词库、模考、录音/上传等接口不随此次开放。不得默认上传完整 Web/Shared 媒体、R2资源或私人内容。最小包及路由封闭需另行实现/验收，本轮不重构产品，也不声称已有 auth-only 安装或部署包。

## 离线 prepare

```powershell
node scripts/auth-local.mjs prepare
node scripts/auth-local.mjs prepare --target tools/auth-local/test-target.template.json --inventory tools/auth-local/test-inventory.template.json
```

以上真实空模板均应返回 `NOT_READY`、退出码2。工具只读显式 JSON 并输出非秘密结果，无 write/create/apply/deploy/remote-migrate/serve 能力，无子进程、网络、秘密/环境值读取；不加载 `.env`、证书、备份或平台凭据。检测到远端/认证/凭据环境**变量名**即阻断，不读取或输出值。用干净独立终端运行，不删除或搬动他人配置。

两个模板是**供集成者填写的本地核对表，不是平台 API 或导出格式**。不能用手填表证明平台真实隔离；当前没有已核的资源枚举接口/响应契约。未来集成者须通过平台原生只读信息取得真实项目、账号、DB ID、DB绑定、hostname及当前生产 DB 禁集，并独立审核/关联至 evidenceRefs 后再填写；拿不到实际元数据时继续 NOT_READY，不编ID，不将本地哨兵当远端库。不可直接传未知官方响应或含token的导出文件。

- target 描述拟用项目/精确 HTTPS origin、DB ID/名/绑定 `DB`；认证变量固定 `LANTERN_AUTH_ENABLED=false`，数据策略固定 `synthetic-only-empty`。
- inventory 核对表须包含当前生产与目标测试两个项目、各自 D1 的实际ID和关系，同一已核平台账号、独占项目关联、真实hostname，采集时间不超过24小时。用途和test名称只是附加检查；生产ID/域名/库名/别名、共享/错绑/未知库、占位、账号或origin不符均拒绝。若实际平台关系超出此窄格式，失败关闭、先核合同，不截断资源信息冒充通过。
- evidenceRefs 仅存非秘密审核引用ID，不放令牌或带查询参数链接；代码不会访问或验证这些引用。`platform-readonly-review`只表示填写者声明来源，不构成验真。测试的 `synthetic-fixture` 明确为虚构输入，任何样例都不是已分配资源。
- 完整一致的核对表最多返回 `PLAN_ONLY`、`ready:false`、`applySupported:false`、`externalVerification:NOT_VERIFIED`，并保留平台事实/权限、auth-only输入、部署/迁移授权、TLS/设备等阻断。退出码0只表示离线格式/交叉校验可生成计划，不表示真实环境准备就绪。
- 仅接受标准精确 HTTPS origin，无路径、查询、用户名、端口或回环/保留域。即使字符串正确，也没有做DNS、证书、可达性或平台归属验证；这些仍需未来真实步骤。

## 未来平台原生步骤（本轮未执行）

1. 获准的 Sites 集成者只读确认或取得独立测试项目、平台自带受信 HTTPS 地址与专用测试 D1，核实际费用/权限/对外访问范围；生产项目与 DB 列为禁集。不能从当前 owner-only 站推断手机可访问。
2. 先解决并审核上述 auth-only 部署输入缺口，再通过平台支持的原生部署流程绑定 `DB`，核认证所需增量迁移及测试库状态；不自创 Wrangler 远端发布/建库命令，不把普通整站构建当最小账号服务。迁移0005–0008及其依赖需由实际库基线决定，本地 migrate 不证明远端迁移已验。
3. 启用前核精确 `LANTERN_AUTH_ORIGIN`、服务HTTPS和same-origin mutation/cookie策略。只做空白合成账号的注册、登录、session v2、退出与失败关闭；不上传学习、guest、私人资料或录音，M1同步/学习上传继续关闭。手机号/找回密码供应商未配置时不启用。
4. 另获准真实接入/设备验证后才设置原生 build-owned `AUTH_API_ORIGIN`。当前仍空、账号网络关闭；`https://lantern.local` 是原有本地存储来源，localhost是本机测试源，都不能替代远端产品认证origin。任何管理凭据都留在平台，不能进入前端/原生包。

## 原有 localhost 工具边界

`npm run auth:local -- check|migrate|serve` 的行为保持原样；**不属于 prepare，无须在本轮运行**。check/serve需要已存在且受信的localhost证书路径，会读取私钥/探测本机TLS；本轮无权读取或生成，不能顺手调用。migrate仅 `--local` 初始化独立本地D1，serve仅回环且 `remoteBindings:false,tunnel:false`。哨兵 `efefefef-0000-4000-8000-000000009443` 绝非远端DB。旧本机严格TLS证据继续继承，不重跑，也不当手机HTTPS后端。

## 保数据升级与真实恢复范围

未来先获准只读核当前已装包/版本与签名连续性，当前均未知。保持 `com.lantern.toeic`、原证书及 `https://lantern.local` 存储来源，目标 versionCode 必须高于实际已装版本（20062只大于已知历史20061，不代表当前设备已核）。使用原位覆盖升级，不卸载、不清数据；若拒绝升级先定位，不能通过卸载解决。最终HAP只签名和官方验签一次；这里没有新HAP/签名/设备结果。

升级前只能使用当前可达身份的既有导出并核系统真实保存结果。新注册产品UID不会接管旧guest/device/rawUID或Sites分区；同一稳定UID才可能重开原路径。不得改JSON里的owner/scope强行导入。

| 现有导出 | 范围与恢复边界 |
| --- | --- |
| `lantern-my-study-records.json` | profile、作答、手记、标记、任务、录音元数据；`audioIncluded:false`，不含原录音。当前UI仅导出，无通用学习JSON恢复入口 |
| `lantern-vocabulary-records.json` | 收藏/复习事件，无owner/原录音/完整工作流。已有本人确认机制可合并至当前已核UID；绑定owner/epoch/代际，取消零写，同ID异内容拒绝；这不是全量跨号迁移 |
| `lantern-workflow-backup.json` | plans/days/sessions/commands/events/outbox及回执等，只允许原scope相等恢复。guest→新UID、旧UID→新UID、Web→Harmony不符合；缺原事实不计完成，不自动执行待确认命令 |
| `lantern-exam-backup.json` | 当前owner模考试题包、题包图片/听力、答案/考试记录，严格owner和身份/冲突校验；试题音频不等于个人口语原录音，不能直接跨UID恢复 |
| 个人原录音 | 另存 `lantern-audio` IndexedDB，当前可达账号可逐条下载wav/m4a/webm；没有通用批量重导入/重新关联或任意旧rawUID导出入口 |

**已知实际缺口**：guest页面生成 `lantern-guest-study.json`、`lantern-guest-vocabulary.json`、`lantern-guest-workflow.json`，但当前 `NativeDownloads.ets` 白名单没有这三个名，鸿蒙会取消下载。JS“备份已生成”不证明系统已保存；不能承诺访客三JSON已落盘。这个产品缺口在本轮未修复，保留原安装和数据，不能以新账号替代迁移或声称一个JSON全备份。计划TXT/周复盘MD仅供阅读，不能恢复。

实现依据：`lib/study-backup.ts`、`app/learn/vocabulary-library.tsx`、`lib/learning-domain-repository.ts`、`lib/exam-storage.ts`、`app/learn/guest-data-recovery-content.tsx`、`harmony/entry/src/main/ets/NativeDownloads.ets`。本页只记录既有行为，不改学习模型、数据scope或强制迁移。

## 本轮窄验证

`node --test tests/auth-test-preparation.test.mjs` 使用明确虚构目标和无网络副作用拦截验证护栏；不调用真实平台、D1、证书或设备。既有 `tests/product-auth.test.cjs` 的“unconfigured authentication”单项用于确认原真实服务关闭语义。结果与精确源码指针统一记录在原 `项目组/internal-beta-20261028/ACCOUNT-IMPLEMENTATION.md`，不把本工具的PLAN_ONLY外推为部署、升级或设备通过。
