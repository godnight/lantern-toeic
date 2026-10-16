# 账号独立审查修订回执（2026-10-16）

本文件记录冻结源码之后的本地修订，不能替代独立 QA 或公开发布批准。已读取外层 `项目组/architecture/USERNAME-PASSWORD-BOUNDARY-20261016.md`、`architecture/AUTH-REVIEW-20261016-01/README.md`、`QA-RESULT-AUTH-WEB-20261016.md` 和 `QA-EVIDENCE-AUTH-WEB-20261016-01/PHASE-HANDOFF.json`。

## 身份与冻结边界

- 原始公共基线：`6294c8902b5fe0a2ac881259ba9926eda0d8fbc4`；原公共目录未修改。
- 原认证冻结：`101209685a200ba49a8762818f86dd8be8a91f29`，`vocab-work/multiuser-auth-20261016/site`；保留原源码和原自测记录。
- 本地 HTTPS 补件：`7660d8b622eae9359b596e3eb8bf33c287066dda`，包含严格 TLS 预检、隔离 D1/R2 与 [运行手册](AUTH-LOCAL-HTTPS-RUNBOOK.md)。
- 本次修订：`vocab-work/auth-local-https-20261016/site`，独立分支 `fix/auth-review-20261016`；精确提交用 `git rev-parse HEAD` 核对，本次提交为上述补件的直接后继。
- 未合入媒体修复、未触碰冻结 CT、模拟器 15551、麦克风或 QA 保留的 10977/PID88408。未 push/merge、部署、创建外部账号或凭证、安装 TLS 信任、修改生产权限。

认证默认仍关闭。原有真实用户名密码、随机稳定产品 ID、服务端摘要会话、A/B 私有数据授权及 +86 格式校验保持；本次没有短信、恢复、原生会话或迁移成功路径。访客、旧 Sites 和已有个人数据没有自动归户或上传。

## AUTH-01：共享额度满后仍创建用户名桶

冻结实现逐项执行用户名计数、全局计数，后者拒绝时前者已经写入。新用户名输入持续造成数据库行与计数增长。修订使用一次 `D1.batch` 事务：

1. 只清理超过 24 小时的最多 128 行，使用已有 `window_start` 索引。
2. 用户名 `INSERT SELECT` / 冲突更新同时检查全局凭证与注册额度，用户名自身也有饱和值；满额不创建行、不更新计数。
3. 追加迁移 `0005_auth_admission_ticket.sql`，在用户名桶记录本次随机 admission ticket。共享计数只在同一事务中看到对应 ticket 时增加；不依赖 JavaScript 先查后写、模块内锁或连接级 `changes()`。
4. 提交返回未准入为 429；数据库异常为 503，进入 KDF 前必须确认共享额度记账完整。已有行、用户、会话与学习数据不改写。

每 15 分钟用户名最多 5 次、全局凭证最多 100 次、注册最多 20 次。正常新窗口由准入产生的用户名键最多 100 个，另有最多两个共享键。每次被拒仍有一个有界数据库事务（登录三条 SQL，注册四条），不是零成本。历史超量桶不会瞬间消失，按既定保留期分批清理。全局配额仍是容量熔断；可信来源限制、机器人防护、跨 isolate 实际容量与费用评估仍是发布条件。

### 负控与并发证据

`tests/fixtures/auth-service-1012096.ts.txt` 是冻结服务源码，仅由测试替身加载。SHA256 为 `f8bb8bc6d3943c3a23ec1f18d4a4f459a47c51bbbaad7b707cce5382bc313afc`；该 fixture 用 `.gitattributes -text` 固定原字节，避免跨环境换行转换；无需 Git 历史或网络即可复现负控。

| 场景 | 观测 | 判定范围 |
| --- | --- | --- |
| 旧源码全局预置 100，再发 1,000 个不同用户名 | 全部 429，但新增 1,000 个用户名桶，全局增至 1,100，执行 3,000 条 SQL | `VULNERABILITY_REPRODUCED`；负控成功不等于安全通过 |
| 修订后全局预置 100，1,001 次拒绝，含已有用户名 | 行数保持 2、全局保持 100；3,003 条有界 SQL | 无新增键或计数增长 |
| 独立 VM/独立 KDF 模块共享 SQLite，剩一份全局额度并发请求 | 仅一项完成真实密码验证并返回 401，其余配额 429 | 不是被同模块 KDF busy 偶然串行化 |
| 实际 workerd + D1，满全局并发 1,000 项 | 1,000 个 `too-many-attempts`，0 个 `auth-busy`，用户名桶 0、全局 100 | 实际 D1 事务准入 |
| 实际 workerd + D1，全局 99 并发 100 项 | 1 个真实 KDF 后 401，99 个配额 429，用户名桶 1、全局 100 | 最后一个额度原子准入；无用户/凭证/会话新增 |
| 用户名/注册饱和、事务故障、过期清理 | 饱和值不再增长；用户名满不花共享额度；失败回滚；单次最多清 128 行 | 见 9 项准入测试及运行时测试 |

独立审查另核对了旧计数超上限后追加 0005 的行为：原计数与行保留，新请求拒绝；过期子查询使用已有索引。本机测试不声称完成生产跨 isolate 负载或计费测量。

## 旧标签页、页面恢复与身份复核

新增 `lib/use-product-session.ts`，由学习入口与账号表单共用：

- 注册、登录和退出成功后，BroadcastChannel 与 storage 只广播版本化失效通知；不传播 ID、用户名、密码、token 或学习信息。请求已发出但响应体损坏/网络结果不确定时也广播失效，并立即重新核对当前页；因为服务端可能已下发新 cookie，不能继续假定还是 A，也不能假定已成功切号。
- 收到通知、页面隐藏/pagehide、回到前台/focus、BFCache 的 pageshow 时，先同步暂停并卸载旧学习工作区，再异步调用服务端 `/api/auth/session`。
- 既有账号首挂载也须确认服务器仍为同一稳定 ID，防止使用旧 HTML 直接恢复 A 的工作区。
- 同一服务端身份确认后才重挂载原分区；身份变化或已退出则整页重新打开，由服务器选择分区。网络错误、无效响应或数据库不可用保持阻断并允许重试，不降为访客。
- 只有原先就是访客、服务端明确返回 `auth-disabled` 且 `passwordLogin=false` 时，保留访客本机学习。原账号 A 不得借此转为访客。原生上下文沿用已有本机边界，不冒充可用的原生账号。
- 复用原工作区卸载、请求 generation/abort、媒体释放及 owner 存储分区逻辑；不清持久数据。未保存内容仅按已有草稿/录音恢复能力保留，不保证所有临时 UI 状态都能恢复。

`tests/product-session-browser-guard.test.cjs` 的 15 项测试加载实际 hook 和学习入口条件树，模拟通知与生命周期，验证先卸载再请求、旧返回不能复活、切号/401 整页切换、503/网络错误继续阻断，以及原生和明确关闭的访客场景。其中新增的 5 项用共享通知总线与实际 guard 验证登录/注册的 200 头后 JSON 失败、fetch 结果不确定和退出结果不确定：当前页与其他 A 标签均先阻断，未知 503 不恢复，只有服务端 401 证据后才导航。**这属于受控组件/事件测试；真实浏览器双标签页、BFCache、实际媒体释放仍 NOT_RUN。**

## 响应截断：定位与对照，没有猜测性产品补丁

新增可选 `tests/auth-http-framing.test.cjs`，全部使用独立随机回环端口。没有连接、重启或停止 QA 的 10977。TLS 诊断客户端显式信任已有测试证书，同时校验链和主机名；没有关闭 TLS 验证或修改系统/浏览器信任，因此不能当作浏览器验收。

本机版本：Node `24.13.1`、Miniflare `4.20260515.0`、workerd `1.20260515.1`。冻结整站 `dist/server/index.js` SHA256：`44f1fd6968c35b0c366e2739b4a5a1694efb0ad0dee30be240c3ad3e19b612dd`。

| 独立对照 | 响应结果 |
| --- | --- |
| 极小 Worker、Miniflare HTTP，未读/读取/取消请求体 | Node 客户端与原始 TCP 均完整 11/11 字节 |
| 同一极小 Worker、Miniflare HTTPS，未读或取消体 | `Content-Length:11`，实际 0 字节，连接不完整；读取体时 11/11 |
| 冻结完整应用 HTTP，配置 HTTPS origin 的早期拒绝 | 403 正文完整，未声称 HTTP 登录可用 |
| 冻结完整应用 Miniflare HTTPS，Study owner 错配/缺 Origin | 409 声明 48 实际 0、403 声明 33 实际 0；Node 与原始 TLS 同样复现 |
| 同入口，UI 原样 logout `{}` / 无请求体对照 | 200 声明 11 实际 0 / 11；服务端旧会话仍已撤销，清 cookie 头存在 |
| 测试用有界 Node HTTPS 入口 → 同一冻结 `dispatchFetch` | 上述 409 为 48/48、403 为 33/33、logout 为 11/11；安全拒绝、撤销与 cookie 属性保留 |

可判定异常存在于当前本机 Miniflare HTTPS 监听传输路径，不需要产品或 Vinext 代码就能重现；尚不能指认其上游内部具体函数。没有给产品端点增加为迎合该路径而读取任意请求体的补丁，也没有换框架/升级依赖。Node HTTPS 适配器仅在诊断测试内，未配置为公开服务。现有本地启动补件采用 Node/Vite HTTPS；其真实受信任浏览器入口仍待验证，不能由这个对照推定通过。

## 验证与复现命令

| 检查 | 本次结果 |
| --- | --- |
| `npm run test:study` | 618/618，含原学习/私有路由负例，以及新增准入与身份复核 |
| 其中 `test:auth` 所列用例 | 60/60：原语 10、路由 25、准入 9、workerd 1、前端复核 15 |
| `npm run typecheck`、`npm run build` | PASS |
| 构建后 `node --test tests/*.test.mjs` | 40/40，含 HTTPS 补件 6 项 |
| `npm run test:auth:transport`（本机可选夹具齐全） | 5/5 诊断；其中包含预期复现缺陷的负控，不是 5 项发布门槛通过 |
| 诊断缺少可选夹具 | HTTP 核心 1 项通过，4 项明确 NOT_RUN/skip；不下载夹具、不生成证书 |
| `npm run auth:local -- migrate` | 本地 9443 隔离 D1 已追加 0005；0000–0005 全部应用，没有创建用户或会话 |
| `git -c core.whitespace=cr-at-eol diff --check` | PASS |

```powershell
Set-Location 'D:/zzl/托业学习/vocab-work/auth-local-https-20261016/site'
git branch --show-current
git rev-parse HEAD
npm run typecheck
npm run test:auth
npm run test:study
npm run build
node --test tests/*.test.mjs
npm run auth:local -- migrate
npm run auth:local -- check
```

最后一项在当前机器预期 exit 2 / `TLS_FILES_REQUIRED`，这是启动拒绝证据，不是页面通过。现有未受信任 QA 证书会触发 `TLS_UNTRUSTED`；不应将其导入信任库来完成本任务。受信任材料已具备后，按 [HTTPS 运行手册](AUTH-LOCAL-HTTPS-RUNBOOK.md) 启动前台 9443/9444；cookie 不按端口隔离，QA/开发必须使用独立浏览器 profile。

可选传输诊断（需要已存在的本地测试证书/匹配私钥和冻结构建；不把这些文件提交到源码）：

```powershell
$env:LANTERN_FRAMING_TLS_CERT='D:/zzl/托业学习/项目组/QA-EVIDENCE-AUTH-WEB-20261016-01/runtime/tls/localhost-cert.pem'
$env:LANTERN_FRAMING_TLS_KEY='D:/zzl/托业学习/项目组/QA-EVIDENCE-AUTH-WEB-20261016-01/runtime/tls/localhost-key.pem'
$env:LANTERN_FRAMING_FROZEN_ROOT='D:/zzl/托业学习/vocab-work/multiuser-auth-20261016/site'
npm run test:auth:transport
Remove-Item Env:LANTERN_FRAMING_TLS_CERT,Env:LANTERN_FRAMING_TLS_KEY,Env:LANTERN_FRAMING_FROZEN_ROOT
```

本机忽略日志：`reports/auth-review-study-final.log`、`auth-review-build-final.log`、`auth-review-mjs-final.log`、`auth-review-local-migrate.log`；传输诊断为 `.auth-local/framing/framing-final-20261016.log`、`no-fixtures-20261016.log`。日志不是公开制品；诊断输出已遮掉 session cookie，不输出密码/令牌。

## 剩余门槛与状态

- **BLOCKED，未尝试绕过：** 在独立浏览器 profile 打开可信 localhost HTTPS 账号页，以及双标签页 A/B、BFCache、媒体卸载与实际启动/停服验收；当前没有现成受信任 localhost TLS，严格预检拒绝。启动文件与迁移已交付，页面与服务生命周期验收未完成。没有自动审批拒绝，本项是已授权范围内的环境前置缺失。
- **待独立复测：** AUTH-01 和旧标签页修订的源码验收；当前 618/40 等是开发自测，不改写原独立 QA 结论。
- **NOT_RUN/未实现：** 真实短信服务商、企业签名资质和预算尚待用户决定；未发码/验码/绑号、未公开上线、未完成可信恢复或原生账号传输。+86 格式合法不代表号码归属已验证。
- **发布前保留问题：** 实际宿主 KDF CPU/内存/跨 isolate 预算、可信来源与滥用控制；已有私有上传路由体长的分配前有界读取；同用户录音幂等/R2 状态复核；访客/旧个人数据迁移需另行明确确认与可预览恢复方案。本批没有扩大这些接口或迁移数据。

原冻结交付与架构三项门槛逐条说明保留在 [原认证开发回执](PRODUCT-AUTH-DEVELOPMENT-20261016.md)，本修订不提升为公开多用户产品验收。
