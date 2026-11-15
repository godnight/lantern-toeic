# 云账号与学习同步候选组件

本目录为隔离的审核候选，不含已部署服务、部署脚本或真实配置。导入模块不会启动网络服务；受控启动器必须显式启用，手机号缺省关闭且需完整独立配置与预检，同步仍然关闭。不要把这些组件直接部署到服务器，也不要接入真实账户或数据。

原生账号候选可在受保护配置中**显式**提供 `directCredentialPolicy`，例如 `{"mode":"direct","credentialsPerWindow":20,"registrationsPerWindow":4,"maxSources":4096}`；省略时该来源限流关闭。范围分别为凭据数 1–99、注册数 1–19 且不超过凭据数、来源表 1–16384；窗口与账号共享额度一致为 15 分钟。只可用于确认客户端直接连接本 HTTPS 服务的部署；**不能用于 HTTP/TCP 代理或负载均衡后方**，也不信任任何转发头。仅密码登录/注册使用真实 socket 对端地址，IPv4 映射地址合并、IPv6 按 /64 聚合；同一 NAT/网段用户共享额度。限额可能使用户比现有逻辑更早看到相同的“尝试次数过多”提示，**正式启用前须向用户展示并确认具体阈值及共享网络影响**。KDF 忙且确认没有服务端计数时退还额度；网络中断或结果未知不退。来源表满时新来源失败关闭、不驱逐未过期条目；状态仅在单进程内存中，重启清空，不覆盖分布式流量或多实例攻击，不能视为完整抗拒绝服务或公开上线保障。

- `domain-policy.candidate.mjs`、`https-gateway.candidate.mjs`：域名证书检查和受控 systemd socket 网关候选，仅显式启用后读取 root 管理的证书，检查 SAN、有效期、密钥、文件权限和系统信任链。实际 Linux socket/权限、真实证书签发及续期仍未验证。
- `auth-worker.ts`、`build-inputs.mjs`：从本仓库固定源码构建最小账号 Worker 和学习模型，只生成内存制品；不读取私人工作区，也不写出配置或凭据。构建需根目录依赖（当前使用锁文件内的 esbuild），尚未形成独立服务器发布包。
- `assembly.candidate.mjs`：账号与同步共用同一个受信 Miniflare/D1 的进程内分发，默认不接同步；不创建监听或服务。手机号仍使用产品中的未配置供应商，无法发送验证码。
- `service.candidate.mjs`、`https-handler.candidate.mjs`、`local-channel.candidate.mjs`：默认关闭的进程内组合、固定路由和临时 HMAC 信封。HMAC 不提供进程隔离；用户仍通过真实账号会话验证。关闭服务会等待已接收的请求结束；调用方应在服务关闭后再释放 Miniflare 和数据库锁。
- `d1-lock.candidate.mjs`、`locked-service.candidate.mjs`：锁定私有数据目录后才打开其下固定 D1 路径，并经只读 schema/迁移账本预检后接入服务；停机顺序为网关排空、运行时关闭、释放锁。进程异常残留锁不会自动清除。锁约束使用同一入口的进程，不防止其他程序直接操作 SQLite。
- `run-controlled.candidate.mjs`、`runner-config.candidate.mjs`、`runner-lifecycle.candidate.mjs`：仅在显式 `--enable --config` 且配置文件由 root 管理、服务组只读时尝试启动。可选手机号配置指定固定域名、短信签名/模板、ECS 角色、私有密钥位置和严格限额，不含密钥或凭据；缺省不开放手机号路由。不接受同步开关。需要已有受控 systemd socket 和证书。
- `production-phone-preflight.candidate.mjs`、`production-pnvs-outbound.candidate.mjs`、`ecs-metadata-transport.candidate.mjs` 和 `phone-*.candidate.*`：受控手机号 Worker 装配候选。默认关闭；显式配置时，对持锁运行者传入的 Miniflare/D1 校验迁移账本、结构和持久额度，再读取受保护的 Linux 私有 key 并构建仓库账号 Worker。短信请求经严格字段约束和固定阿里云 PNVS 出站；每日、每分钟、每号码发送与验证码校验各有硬上限。候选受控启动器在同一 D1 锁内切换 Worker、再次核验数据库后才开放固定 HTTPS 手机号路由。首次手机号注册、已有账号登录、重启及未知短信结果的处理仅经合成 Worker 和假供应商验证；尚未部署，也不构成可用的真实短信登录。
- `unified-d1-sync.candidate.mjs`、`production-sync-*.candidate.mjs` 和 schema 清单：同库会话校验及词汇、答题、打卡同步候选。服务端从账号会话确定用户，写入 SQL 同时复核会话；客户端提供的 owner 不能代替验证。启动预检校验 schema、迁移账本、独立密钥和模型摘要；遇到尚不支持的旧记录时关闭。
- `sqlite-d1-core.candidate.mjs`、`synthetic-sqlite-d1.candidate.mjs`：SQLite/D1 接口子集候选及合成测试包装，只接收已有连接，不打开文件或提供服务。只实现账号路径需要的部分 `prepare`、`bind`、`first`、`all`、`run` 和原子 `batch`，不宣称完整兼容 D1。Node 24.13.1 合成测试覆盖真实账号 Worker 的注册、登录、重启、账号隔离、事务回滚和多进程竞争，以及假短信供应商的手机号注册、错误码和结果未知；正式数据目录、并发负载、崩溃恢复、备份/迁移及真实手机号和华为链路均未验证，禁止用于生产。
- `synthetic-node-runtime.fixture.mjs`：只供测试启动的独立进程，使用原生 Node `Request` 和账号 Worker、上述 SQLite 子集及既有路由/通道，且只监听本机回环地址和临时自签名证书；测试覆盖锁冲突、并发注册、重启、不同账号、退出及数据库结构损坏拒绝启动。它不验证正式 systemd socket、生产证书、目标服务器或公网访问，不是发布制品。
- `native-account-config.candidate.mjs`、`native-account-runtime.candidate.mjs`、`run-native-account.candidate.mjs`：默认关闭的账号专用启动候选，仅在显式参数和 root 控制的配置下运行，验证固定 Worker 哈希、已有服务用户私有数据库、协作锁、WAL、只读完整性及账号 schema/账本，再通过现有受控 HTTPS 网关；不接受手机号或同步配置。可选的华为配置仅接受数字 clientId 和独立的绝对路径 `secretFile`，文件名固定 `huawei-client-secret`；目录须 root 持有、服务组为所属组且权限为 0750，文件须 root 持有、服务组只读且权限为 0640，无链接或不安全祖先。密钥内容只接受 1–8192 个可见 ASCII 字符，无换行，不能写入配置、环境变量或仓库。未配置即关闭，配置不完整或文件不安全会拒绝启动；出站仅允许真实 Worker 使用的两个华为 HTTPS 接口且禁止自动跟随重定向。仅通过虚构凭据和假供应商验证真实 Worker 的能力发现、绑定、登录及归属校验，没有读取或迁移现有凭据。当前仅允许 Node 24.13.1 非 root Linux，未形成安装程序或审定发布包；华为凭据文件的目标 Linux 权限及真实供应商尚未验证。此版本尚未在真实 Linux 权限、systemd socket 或正式证书下完成端到端验收，禁止直接部署。

目前没有已部署的生产账号服务、经过真实运营验证的 PNVS 服务、审定的学习模型发布制品、生产数据库迁移/备份恢复、证书签发续期或经过实测的正式服务器配置。2026-11-15 用户截图显示，旧隔离测试包在阿里云 ECS 上补充 systemd 命令路径后，通过合成账号、手机号关闭、D1 重启、锁和 SIGUSR2 检查；它不覆盖当前候选的真实证书、HTTPS 网关或真实数据。启用手机号前必须在同一数据库锁下完成预检、关闭旧 Miniflare 并重新打开同一持久库，不能只换 Worker 而放弃锁。启动 Miniflare 可能初始化未知目录的 SQLite 文件，schema 检查不能证明真实数据库身份或代替启动前备份。账号预检可识别审定的基础版和手机号版结构，但不会执行迁移。profile、题目标记、资料任务、录音和已有设备数据迁移均未覆盖。候选同步仅通过本地合成检查，不能用于判断任何真实账号已迁移或手机已能直连。接入前必须单独审查以上缺口，并在隔离环境与真机验证。

持久化路径尚未定案。Cloudflare 将 [Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/) 与其 [D1 本地支持](https://developers.cloudflare.com/d1/best-practices/local-development/)描述为开发/测试模拟；上述隔离成功不证明它适合作为本项目正式数据库。[D1 的 `batch`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) 要求失败时回滚整个批次，这是本实验的必要兼容语义之一。当前实验所用 [Node.js 24.13.1 的 `node:sqlite`](https://nodejs.org/download/release/v24.13.1/docs/api/sqlite.html) 文档标为 Active development，API 同步执行，现有试验也不能证明它已经适合作为正式服务主线程存储。需先确定受支持的生产运行时和持久数据库、实现并验证并发与隔离、备份/恢复和迁移，再决定正式集成。

当前本机账号库的迁移账本使用 `0000_product_auth`、`0001_auth_admission_ticket`、`0002_huawei_auth`，与本候选预检的 `0005/0006/0009` 不同。候选不会直接接受旧账本，也不会改写或迁移它；必须先核对旧库真实结构及散列、演练映射和回滚，验证可靠备份恢复后再决定迁移。协作锁不能阻止绕过该入口直接访问 SQLite 的其他进程；Worker 哈希只与 root 配置一致，不等于制品已签名或完成来源审核。

当前模拟测试中的私有构建器仅为测试临时暴露；正式模块不导出无预检的 Worker 构建入口。测试会暂时解除合成号码的本地重发窗口以验证重登，不更改每日总预算；没有调用真实供应商。遇到发送结果不明会隔离该号码、不会自动重发，仍缺可信的人工对账恢复流程；凭据预取失败也可能保守进入未知状态。真实 ECS 元数据、IAM、短信模板、预算、证书和国内直连都未验证。

当前 Miniflare 会自行处理 SIGTERM/SIGINT 并强制退出，不能用这两个信号声称优雅停机。受控入口监听 `SIGUSR2`；拟用 systemd 必须评估 `KillSignal=SIGUSR2`、`KillMode=mixed` 和足够的 `TimeoutStopSec`，以免启动初始停机信号同时送到工作进程。超时强杀或崩溃可能遗留锁，需要人工核验进程和数据库后恢复。以上配置和完整信号链尚未在目标 Linux/systemd 验收，不提供自动安装或清锁。

仓库内定向检查：

```sh
node --test server/cloud-candidate/*.test.mjs
```

测试使用临时或内存数据、虚构会话及假供应商，无外部服务连接；只证明被测约束，不代表云端和设备验收。
