# AUTH-REV-BARRIER-01：200 响应头后的身份屏障修订

2026-10-16；本地开发回执，等待独立定向复审。未公开上线、未真实短信联调。

## 精确基线和范围

- 已读取 `项目组/architecture/AUTH-REVISION-REVIEW-20261016-01/README.md` 及 `barrier/README.md`。该复审在独立 SQLite 与本机 workerd/D1 范围内关闭 AUTH-01，同时提出本项 P2；本次不重写准入逻辑，也不扩大其结论。
- 冻结基线：`c9146e491fb40ffdce290324ff8995db2d0a045e`，`fix/auth-review-20261016`，原 `vocab-work/auth-local-https-20261016/site` 仅只读保留。
- 新工作区：`D:/zzl/托业学习/vocab-work/auth-response-barrier-20261016/site`；分支 `fix/auth-response-barrier-20261016`，直接从 c9146e4 建立。交付提交以 `git rev-parse HEAD` 核对。
- 同锁文件复制已有 node_modules，未安装或下载依赖，未换框架。旧1012096、公共6294c89及所有 CT/媒体冻结目录均未修改；没有 push/merge、部署、个人数据迁移、生产权限或设备操作。
- TLS 创建/当前用户信任许可仍 PENDING。本次没有生成密钥/证书、导出私钥、写信任库、读取 QA 私钥、启动浏览器或触碰保留端口10977、模拟器15551、麦克风。

## 问题和修复

冻结账号表单在 `fetch()` 返回200后先等 `response.json()`，解析完才广播。服务器可能已提交会话并下发 Cookie，正文却不结束也不抛错：另一个持续 visible 的 A 页面没有收到通知，账号页也一直 busy。已有会话探测的15秒期限并未启动，无法覆盖这个窗口。本项并非服务端 A/B 授权绕过的证据。

产品改动只在 `app/account/account-form.tsx`：

1. 注册/登录/退出共享有界认证操作。收到200响应头后，立即广播无身份信息的失效通知，设当前表单屏障并启动独立 `/api/auth/session` 复核，之后才读取 mutation 正文。
2. mutation 正文仅检查格式/提供未确认诊断，不选择 owner、不解除屏障、不执行导航。账号变化/401后的导航仍只由现有服务端会话 guard 决定；同身份正证才可恢复原视图。未知错误保持阻断。
3. 整个 mutation 的 fetch 与读体共用15秒截止。独立 deadline Promise 与操作竞争，因而即使读体不响应 Abort，也不会无限占用账号操作；超时表示结果未知，不能解释成服务端取消或回滚。
4. 操作有 alive、generation、AbortController 和已失效标记。卸载、完成、超时及会话已进入导航时释放定时器/中止当前操作，使晚到头、正文或错误不再写状态、导航或重复通知。已在200头启动的独立复核不被损坏正文重复重置；正文到截止时则重新设本页屏障并发起 fresh 会话探测，即使之前曾确认同一个 A，也不能拿较早正证乐观处理超时。跨文档失效每操作仍只广播一次。
5. 明确非200的正常拒绝保留失败行为；不以拒绝响应建立身份。没有修改认证密码/会话实现、D1迁移、私有业务路由、播放器或存储分区。

`tests/public-local.test.cjs` 只补期限计时器接线，并将成功断言从“mutation JSON 直接导航”改为“请求独立身份复核、mutation 自身不能导航”；原取消、校验、明确拒绝、请求合同断言保留。完整 guard 行为由实际 hook/入口条件树测试承担，未用该接线桩假称服务端身份已确认。

## 挂体负控与新回归

新增固定的 `tests/fixtures/account-form-c9146e4.tsx.txt`，逐字节等于冻结提交的实际 AccountForm：12,898字节，LF，SHA256 `f3bd825677ef8381c9629ea1346fba2d3808f8fe642ee22e790224707b619b38`。`.gitattributes -text` 防止换行转换；测试无需 Git 历史、网络或外部证书。

测试使用真正 WHATWG `Response` + `ReadableStream`，只写入半段 JSON、不 close，使实际 `response.json()` 持续 pending；并非导入失败、缺夹具或用失败 Promise 冒充挂起。实际 hook 与 StudyApp 条件树保留，另一个 A 文档始终 visible，没有人为 focus/visibility 唤醒。

- **旧码负控两项：** 登录、注册的200头已返回且 bodyUsed=true，但正文未完成时通知0、mutation期限0、另一个 A 工作区仍交付；释放正文后通知能正常卸载 A，证明总线有效。结果为 `VULNERABILITY_REPRODUCED`，不能计为安全通过。
- **修订回归：** 在同样挂起正文、尚未触发任何 timer 的时刻，当前页已屏障、其他 A 工作区已停止交付，独立会话 GET 已开始。仅独立 B/401正证允许导航；mutation JSON 即使返回合法 B 也不能替代未知503或挂起的会话证据。
- **时间与迟回：** 覆盖响应头前 fetch 不 settle、200后 body 不 settle、独立会话读体挂起、截止后晚到头/正文、旧探测迟回、卸载和重试后旧操作，保留原损坏JSON/fetch未知、明确拒绝和页面生命周期场景。

这些是受控组件/事件/真实流读体测试。StudyWorkspace子树仍按既有 harness 作为 opaque 组件检查是否交付，未挂完整 React DOM、真实存储、播放器或麦克风；不证明真实 Cookie 已落盘或媒体已释放。

## 验证结果与命令

本次实际结果如下；原 c9146e4 的60/618/40及其交接记录保留为历史结果，不直接当作本修订通过。

| 检查 | 本次结果与边界 |
| --- | --- |
| 屏障专项 | 27/27：2项旧码 `VULNERABILITY_REPRODUCED` 负控，25项修复/回归，不能合称27项安全门槛通过 |
| 屏障 + public-local | 35/35：上述27项及8项已有表单/边界回归；没有删除原有拒绝或取消断言 |
| `npm run test:auth` | 72/72，包含上述27项及原语/真实私有路由/准入/workerd用例；含已注明的旧源码负控 |
| `npm run test:study` | 630/630自动回归（含已注明的负控），原学习、数据归属与业务路由回归保持 |
| `npm run typecheck`、`npm run build` | PASS；构建包含原账号与四类私有API路由 |
| 构建后 `node --test tests/*.test.mjs` | 40/40；没有把构建或预检测试当作浏览器验收 |
| 差异检查与冻结保护 | `git -c core.whitespace=cr-at-eol diff --check` PASS；c9146e4、1012096、6294c89原目录HEAD不变且工作区干净 |

独立只读复核确认：200失效在读体前；mutation没有直接导航；同步重入取消后先检查代次才开始读体；超时、卸载、重试不会让旧结果恢复视图。定时器和controller在受控完成/卸载场景无残留。该复核是实现检查，不替代外层架构与QA的定向再验。

```powershell
Set-Location 'D:/zzl/托业学习/vocab-work/auth-response-barrier-20261016/site'
git rev-parse HEAD
node --test --test-name-pattern 'negative control' tests/product-session-browser-guard.test.cjs
node --test tests/product-session-browser-guard.test.cjs tests/public-local.test.cjs
npm run typecheck
npm run test:auth
npm run test:study
npm run build
node --test tests/*.test.mjs
git -c core.whitespace=cr-at-eol diff --check
```

挂体负控的PASS表示预期旧缺陷复现；其余修订场景须分别核对。忽略目录 `reports/` 保留 `barrier-negative-control.log`、`barrier-focused-final.log`、`barrier-typecheck-final.log`、`barrier-auth-final.log`、`barrier-study-final.log`、`barrier-build-final.log` 和 `barrier-mjs-final.log`，不把环境日志或测试凭证作为公开制品提交。

## 独立接续与未验边界

定向复审请核对200头/正文之间的时间点、独立身份正证、整个操作deadline、重复/晚回无副作用，再结合服务端既有A/B负例判断；不要仅看总数或把负控复现并入产品安全通过。

真实浏览器双窗口、BFCache绘制、Cookie送达、导航、完整React调度、实际启停与媒体释放仍 **NOT_RUN/BLOCKED**。TLS用户许可仍待答复，本轮没有再次询问或执行信任变更，也没有自动审批拒绝。授权和材料具备后，由根协调QA在本新工作区按 [严格HTTPS手册](AUTH-LOCAL-HTTPS-RUNBOOK.md) 运行；迁移与状态为工作区各自隔离，本轮未初始化新工作区D1或启用账号页。

生产CPU/内存/跨isolate预算、可信来源防滥用、已有上传体长边界与录音R2一致性、可信恢复、原生账号、真实短信、旧数据迁移及公开启用均保留原门槛。认证默认关闭，不因本修订通过而开放服务。
