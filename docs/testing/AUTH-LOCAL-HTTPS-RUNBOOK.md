# 账号页本地 HTTPS 运行手册

> 200响应头屏障修订的新独立目录是 `vocab-work/auth-response-barrier-20261016/site`、分支 `fix/auth-response-barrier-20261016`；若验该修订，请把下文Set-Location切到新目录再按同一严格约束执行，D1/R2状态不与旧目录共享。TLS创建/信任许可仍pending，本轮未创建材料或启动服务。见 [本轮交接](AUTH-RESPONSE-BARRIER-20261016.md)。

> 启动补件冻结于 `7660d8b622eae9359b596e3eb8bf33c287066dda`。当前同一独立目录已接续到 `fix/auth-review-20261016`，追加0005迁移；本手册启动约束继续有效，最新修订/传输证据见 [审查回应](AUTH-REVIEW-REVISION-20261016.md)。下文原分支名为补件的历史身份，不要求回退源码。可信TLS与浏览器验收仍BLOCKED。

2026-10-16，独立补件；冻结实现 `101209685a200ba49a8762818f86dd8be8a91f29` 及其 worktree 未修改。当前目录 `D:/zzl/托业学习/vocab-work/auth-local-https-20261016/site`，分支 `docs/auth-local-https-20261016`。本文件不宣称浏览器认证链路已验收。

## 当前阻碍（必须先读）

当前机器**未发现已有可信 localhost HTTPS 方案**。CurrentUser/LocalMachine 的相关证书存储无可用 localhost 证书；`dotnet` 只有运行宿主，没有 SDK，`dev-certs https --check` 不可用；mkcert 不在 PATH。外层 QA 的 `项目组/QA-EVIDENCE-AUTH-WEB-20261016-01/runtime/tls/localhost-cert.pem` 虽含 localhost/127.0.0.1 SAN，但 Windows 链检查为 `UntrustedRoot`。仅检查了公开证书和私钥文件是否存在，没有读取该私钥。

**当前页面启动/浏览器 A/B 验收状态为 BLOCKED（缺可信 TLS 前置），不是已通过。** 未申请或安装信任、未生成新证书、未修改系统信任库、未绕过浏览器警告。缺文件时 `check`/`serve` 都以 exit 2 拒绝；已有不受信任自签证书也拒绝。不要关闭 Secure、Origin、CSRF 或 TLS 校验，不使用浏览器的忽略证书错误参数。

若 QA 后续已有获准且受操作系统及目标浏览器信任的 localhost 证书与匹配私钥，可按下述命令启用。此补件不包含获取/安装证书步骤，不授权新增信任。即使 Node 严格预检通过，目标浏览器若出现证书警告，仍立即停止页面验收。

## 文件与隔离范围

| 文件 | 用途 |
| --- | --- |
| `scripts/auth-local.mjs` | `check`、`migrate`、`serve`，前台运行、Ctrl+C 停止 |
| `tools/auth-local/profile.mjs` | 固定回环地址、端口/路径、系统 CA 和主机名检查、私钥真实路径保护 |
| `tools/auth-local/vite.config.mjs` | 独立 Vinext/Vite/Cloudflare 本地配置，直接调用也必须通过 TLS 预检 |
| `tools/auth-local/wrangler.json` | 纯本地 D1/R2 名称与占位 ID、固定兼容日，无账号或项目凭据；默认 auth=false |
| `.auth-local/9443/`、`.auth-local/9444/` | 各自的忽略目录：D1/R2、本地日志和 Vite 缓存；不读取旧 `.wrangler` 或其他候选存储 |

QA 专用端口 **9443**；开发如需另开，明确选择 **9444**。只允许这两个端口，绑定 **127.0.0.1**，`strictPort=true`，占用即报错，不自动换端口、不杀他人进程。页面地址分别为 `https://localhost:9443/account`、`https://localhost:9444/account`；**不要把地址改为 127.0.0.1 或 HTTP**，否则不匹配精确 origin/证书。

**端口不隔离 Cookie。** 两个端口都用产品原有 `__Host-lantern-session`。QA 与开发须用不同浏览器用户配置（不同 user-data-dir，或不同浏览器产品）；两个普通窗口/同一隐私模式的多个窗口不构成独立 Cookie 容器。否则登录会覆盖另一个端口的 Cookie，导致对端 401。服务器 D1 仍隔离，但不能把这一情境称为会话隔离通过。

## 1. 准备独立目录与依赖

本目录已经从冻结提交建立；不要在冻结目录运行本地服务。当前已有同锁文件依赖，Node `24.13.1`。新环境先用根锁文件正常安装依赖；不安装额外框架或不明脚本。HTTPS 预检使用 Node 的 `tls.getCACertificates`，缺此 API 会拒绝。

```powershell
Set-Location 'D:/zzl/托业学习/vocab-work/auth-local-https-20261016/site'
git status --short
$env:LANTERN_LOCAL_AUTH_PORT='9443' # QA；开发另用9444及独立浏览器配置
npm run auth:local -- check
```

当前最后一条预期 `TLS_FILES_REQUIRED`、exit 2。工具拒绝独立目录中的 `.env*`/`.dev.vars*`，并拒绝带外部 Cloudflare 账号/环境选择变量的终端；请用干净独立终端和 worktree，不删除原配置。`secrets.required=[]`、`remoteBindings=false`，无远程 D1/R2、无托管项目 ID、无隧道自动启动；TTY 的 CLI 快捷键也禁用，不能用 `t` 临时打开隧道。

## 2. 初始化纯本地 D1（不启动页面，不要求 TLS）

```powershell
npm run auth:local -- migrate
```

包装器只调用已有 Wrangler：`d1 migrations apply DB --local --persist-to <本目录>/.auth-local/9443/state --config tools/auth-local/wrangler.json`，自动应用 `drizzle` 的追加迁移。Wrangler 和 Vite 插件都在同一 `state/v3/d1`，同一纯本地数据库占位 ID；不会找线上同名数据库。可重复执行，不清数据。此步骤只建表，不建立固定账号、不导入个人数据。迁移成功与 TLS/页面可用分别记录。

## 3. 已有可信证书到位后再启动

以下两个路径是**已有获准文件的占位**；必须替换，不能原样执行或指向已知不受信任 QA 自签证书。私钥真实路径必须在整个源码目录之外（包括 public），不复制或提交私钥。

```powershell
$env:LANTERN_LOCAL_TLS_CERT='C:/approved-existing-tls/localhost-cert.pem'
$env:LANTERN_LOCAL_TLS_KEY='C:/approved-existing-tls/localhost-key.pem'
npm run auth:local -- check
if ($LASTEXITCODE -ne 0) { throw 'TLS前置未满足，停止页面验收' }
npm run auth:local -- serve
```

`serve` 不部署、不自动打开浏览器。TLS 只用既有系统/内置 CA，验证有效期、localhost SAN、链、主机名和证书/私钥匹配，不把传入叶证书追加为受信任 CA。启动配置只在预检通过后向本地 Worker 注入 `LANTERN_AUTH_ENABLED=true` 和精确 `LANTERN_AUTH_ORIGIN=https://localhost:9443`；9444 则严格对应 9444。产品原 Secure/HttpOnly/SameSite Cookie 和 CSRF 校验原样保留。

正常启动后，在 **QA 独立浏览器配置** 打开指定 URL。若服务是第一次启动但未运行迁移，账号 API 会 503；停止后执行第2步，不能用假会话顶替。不会自动造出已登录状态。Node TLS 预检/账号 UI 构建成功都不能替代这一步浏览器验收。

## 4. 合成 A/B 手工验收

1. 使用新浏览器配置；不导入访客/旧用户数据。在账号页注册合成用户名，例如 `qa_a_20261016`，密码使用密码管理器生成且满足页面要求；不要把密码、Cookie 或令牌写入报告、命令日志或截图。
2. 注册成功回学习页，记录脱敏后的稳定 ID；保存一项合成昵称/练习。核对 Cookie 的 Secure/HttpOnly/SameSite 属性及同源 API 返回，不复制 token 值。
3. 通过账号页退出，确认旧会话失效且返回干净访客；再注册 `qa_b_20261016`。B 无 A 数据，A 的资源 ID 请求不能读取；B 保存的合成记录不能写入 A。
4. B 退出、A 重登：A 的记录保留，B 不混入。错误密码、会话失效、取消切换、401/403/409 和429按真实响应记录。退出不清库；不执行跨账号迁移。
5. 本地上限仍为每名 5次/15分钟及单 isolate 一个密码派生；429时按 Retry-After 重试，不降低哈希成本、不删限流表冒充通过。

这里只说明独立 QA 可执行步骤，当前没有执行或宣称通过。原生、短信、真实宿主预算和公开发布仍未验。

## 5. 停服与复测

在启动的前台终端按 **Ctrl+C**；runner 调用 Vite `server.close()`，由插件关闭其 Miniflare/workerd。不要使用宽泛 taskkill 或终止别的验证进程。停止后 URL 应不可达；本地 D1/R2、浏览器配置及数据保留，不自动删除。若端口仍占用，记录本进程 PID 和实际命令并交回核对，不盲杀或继续占用同端口。

移除本终端的临时路径变量（不影响文件/信任库）：

```powershell
Remove-Item Env:LANTERN_LOCAL_TLS_CERT,Env:LANTERN_LOCAL_TLS_KEY,Env:LANTERN_LOCAL_AUTH_PORT -ErrorAction SilentlyContinue
```

## 本批实际证据与边界

- 独立本地 `migrate` 应用全部 0000–0004，exit0；没有创建用户或监听账号页。
- 缺 TLS 材料拒绝 exit2；已知 QA 自签证书仅用公开证书验证为不受信任并拒绝，未读取其私钥。
- `node --test tests/auth-local-profile.test.mjs` 覆盖端口/状态隔离、拒不安全 TLS 环境、缺证书拒绝、端口占用拒绝、私钥源码路径拒绝、外部环境拒绝和无远程配置。
- 可继续执行 `npm run test:auth`：真实 Node/SQLite 与本机 workerd 的服务端层；其 HTTPS Request 对象不是浏览器 TLS 会话，不能据此报告 Cookie 在浏览器送达或 A/B 页面验收通过。
- 当前可信 HTTPS 启动、浏览器真实 A/B、实际停服、真实 R2/宿主、短信和原生均 NOT_RUN/BLOCKED；没有权限拒绝或结果未知操作。TLS 是缺前置，不是自动审批拒绝。

实现参考：[Node CA API](https://nodejs.org/api/tls.html#tlsgetcacertificatestype)、[Cloudflare Vite 插件 API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)，并核对本机锁定插件 1.37.1 的 persistence/CLI shortcuts 行为。外部文档只用于核 API，没有开服务或修改外部状态。
