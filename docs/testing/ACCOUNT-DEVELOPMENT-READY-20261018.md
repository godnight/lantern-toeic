# 账号开发分支接续与录音存储修复（2026-10-18）

此分支可以交付源码继续审查；**账号浏览器验收、生产启用和鸿蒙账号验收仍未完成**。它不替换当前个人学习站。原生手机号登录、短信和账户恢复没有新增完成状态。

## 源码与个人版的关系

- 工作目录：`vocab-work/account-validation-20261018/site`；本轮基线 `2e6940dcfaed3a8e255870d842f68df00fa2de2c`，交付分支 `fix/account-recording-storage-20261018`。
- 继承用户名密码产品身份、真实服务端会话、A/B 隔离、原子准入额度、旧标签页/BFCache 检查和 200 响应头即时失效屏障。认证开关默认关闭，不能凭旧 Sites 身份头访问私有 API。
- 日期修复 `67acbe9` 和实际请求体字节上限 `2e6940d` 已在此分支。个人版另行移植为 `99fb255`，没有把身份系统带过去。`study-backup.ts`、`request-body.ts` 忽略行尾后相同；`study-model.ts` 的严格日期判据相同，但本分支新账号默认无考试日期、口语目标为 0、初始时区 UTC，旧记录使用历史默认补全。个人版保留个人配置；不能整文件覆盖。
- 本轮移植个人版 `971d545` 后续完善的 `lib/recording-upload.ts`，包含插入结果未知时保留私有对象的修订。对照个人冻结 `bb4ff23`，模块字节完全一致，SHA256 `c2b85d48bb776adad01a435834977a37634d8305699fb7660585d469150007b3`。
- 路由继续从实际请求的产品会话取 `userId(request)`，owner 和 Origin 门禁先于请求体/R2。内容或全局 ID 冲突映射为 **422**；身份 owner 不匹配仍为 **409**。因此内容冲突只阻塞相应录音，后续记录仍可同步，不误触发整个账号的身份失效。
- 本轮未移植 r20/PCM 采集或播放修改；个人版对应录音实现和设备证据须沿其自身交付继续验收。本分支没有新 HAP、生产配置或新发布身份，原 `PUBLIC-LOCAL-20261015-r3-358f50f8fc76` 只作历史标识，不能用于宣称本次构建已发布。

## 录音存储行为

同 ID 重传只有 owner、不可变元数据、MIME、字节长度和 SHA256 均匹配才确认成功；发生时间和原对象保持不变。每次新上传使用随机私有对象键，R2 写后读回校验后再执行 D1 冲突不覆写插入，最后读获胜行；失败或并发请求不能覆盖或删除获胜对象。旧固定对象键继续读取和完全相同的重传，不批量迁移旧数据。

数据库插入可能提交但丢失 ACK，或暂时无法读到结果，此时返回 503 并保留私有对象。可能产生待核对的未引用对象，不能仅凭一次读回为空立即删除；本轮没有自动垃圾回收、批量云端删除或旧损坏音频恢复。R2/D1 故障仍保留客户端录音及待同步状态。

## 实测与复现

本轮使用已有锁定依赖，无真实账号、生产 D1/R2、个人学习数据或麦克风输入。依次执行：

```powershell
npm run typecheck
node --test tests/account-recording-storage.test.cjs tests/product-auth.test.cjs tests/request-body-routes.test.cjs tests/study-invariants.test.cjs
npm run test:auth
node --test tests/account-recording-runtime.test.cjs
node --test tests/auth-http-framing.test.cjs tests/auth-local-profile.test.mjs
npm run build
node --test tests/version-code.test.mjs tests/ui-components.test.mjs tests/rendered-html.test.mjs tests/release-publishing.test.mjs
git -c core.whitespace=cr-at-eol diff --check
```

| 范围 | 本轮结果与限制 |
| --- | --- |
| 原 `2e6940d` 全 study 基线 | 706/706，根代理本轮已跑，原件 `../core-study.log`；本代理没有把它重复运行或冒称是修改后全量结果 |
| 存储/实际账号路由/请求字节/学习队列 | 137/137；含 16 项存储用例，以及 422 后保留原音频并继续上传后续录音的 hook 回归 |
| Auth 专项 | 72/72，含真实强成本 scrypt、本地 workerd+D1 生命周期、准入事务、响应挂体与跨页屏障；与前一组有重叠，不能相加当独立总数 |
| 录音实际本地 runtime | 1/1；实际生产 auth/recordings 模块、真实本地 workerd D1/R2，强参数合成 A/B 注册，验证重传不变、内容冲突、跨账号下载隔离、owner/Origin/无会话门禁、WAV MIME 与字节；没有替换认证函数 |
| Transport + 本地 TLS 配置 | 11/11；其中传输诊断 **成功复现旧冻结构建的 HTTPS 截断**，Node TLS 对照完整；不是浏览器通过。显式证书 CA 只给诊断客户端，链与主机名校验仍开启，不改系统信任 |
| TypeScript / Web build | 均通过；build 有既有大于 500 kB chunk 提示。只是本地源码构建，不是账号发布 |
| 构建产物及发布工具测试 | 34/34；加此前已验 local-profile 6 项对应既有 mjs 40 项，未重复累计 |

新增存储 runtime 验证通过 `npm run test:auth:storage` 运行，并纳入 `test:study`。故障注入用例用真实产品会话 + SQLite、R2 传输适配器；只有 runtime 专项使用本机 workerd 的实际 D1/R2。它们不证明生产边缘的延迟、费用、限额和浏览器 Cookie 链。

本机忽略目录原件在 `vocab-work/account-validation-20261018/`：`account-storage-FINAL.log`、`account-auth-FINAL.log`、`account-recording-runtime.log`、`account-transport-local-20261018.log`、`account-typecheck-storage.log`、`account-build-20261018.log`、`account-built-artifact-checks.log`。保留首次测试失败：一次 helper 将测试伪 owner 覆盖回正常 owner；一次 Node FormData 直接传入 Miniflare 的不同 fetch 实现而未编码导致 400。最终 helper 真实传错 owner，runtime 先用 Node Request 编码 multipart 字节；没有放宽生产门禁或测试断言。

本次本地 server bundle SHA256 为 `29227f7822a275b64029e560ad6e5873794033132be2264e153bc52c9eec8749`。最终源码以本文件所在提交的 `git rev-parse HEAD` 为准；源码不包含密码、Cookie、签名材料、TLS 私钥或真实录音。

## 仍需完成的验收与启用条件

1. 用户已同意本轮临时信任测试证书，但两次 Windows 导入均挂起，已停止本轮进程。`../HTTPS-TRUST-ABORT-CLEANUP.json` 记录 2026-10-18 01:24 本地时间，CurrentUser/LocalMachine 的目标 Root 条目均不存在，本轮 TLS 账号页面未启动。不能再把状态表述为“等用户同意”；当前是环境导入未成功。没有降低 Secure/HTTPS/Origin/CSRF 门槛，后续按 [本地运行手册](AUTH-LOCAL-HTTPS-RUNBOOK.md) 解决可信 HTTPS 后再做真实浏览器注册、登录、退出、多标签页 A/B 验收。
2. 仍需独立审查此账号整合提交及真实浏览器验收；本轮开发测试不关闭公开账号验收。默认关闭保持有效，禁止把此分支直接覆盖个人 Sites 生产站，否则旧 owner 无法凭 Sites 头访问原题包。没有自动认领访客/旧 Sites 数据；迁移需要明确设计、备份和单独验收。
3. 生产宿主 scrypt CPU/计费/峰值内存、可信边缘来源限流、注册滥用防护、账户恢复和生命周期仍未完成。生产启用之前必须解决，不能降低 KDF 成本代替容量验证。
4. 原生安全凭证存储、登录传输、手机号码验证/绑定与短信供应商、旧账号迁移均未交付；录音真机听感/倍速等跟随个人媒体分支，不能借本次存储测试宣称完成。

本轮提交准备供集成负责人推送开发分支，未直接 push、merge、部署或修改生产开关。以下历史交接中的“当前”、旧路径和待许可措辞以其当时日期为准，最新状态以本文件为准。
