# 云账号与学习同步候选组件

本目录为隔离的审核候选，不含已部署服务、部署脚本或真实配置。导入模块不会启动网络服务；受控启动器必须显式启用，手机号缺省关闭且需完整独立配置与预检，同步仍然关闭。不要把这些组件直接部署到服务器，也不要接入真实账户或数据。

- `domain-policy.candidate.mjs`、`https-gateway.candidate.mjs`：域名证书检查和受控 systemd socket 网关候选，仅显式启用后读取 root 管理的证书，检查 SAN、有效期、密钥、文件权限和系统信任链。实际 Linux socket/权限、真实证书签发及续期仍未验证。
- `auth-worker.ts`、`build-inputs.mjs`：从本仓库固定源码构建最小账号 Worker 和学习模型，只生成内存制品；不读取私人工作区，也不写出配置或凭据。构建需根目录依赖（当前使用锁文件内的 esbuild），尚未形成独立服务器发布包。
- `assembly.candidate.mjs`：账号与同步共用同一个受信 Miniflare/D1 的进程内分发，默认不接同步；不创建监听或服务。手机号仍使用产品中的未配置供应商，无法发送验证码。
- `service.candidate.mjs`、`https-handler.candidate.mjs`、`local-channel.candidate.mjs`：默认关闭的进程内组合、固定路由和临时 HMAC 信封。HMAC 不提供进程隔离；用户仍通过真实账号会话验证。关闭服务会等待已接收的请求结束；调用方应在服务关闭后再释放 Miniflare 和数据库锁。
- `d1-lock.candidate.mjs`、`locked-service.candidate.mjs`：锁定私有数据目录后才打开其下固定 D1 路径，并经只读 schema/迁移账本预检后接入服务；停机顺序为网关排空、运行时关闭、释放锁。进程异常残留锁不会自动清除。锁约束使用同一入口的进程，不防止其他程序直接操作 SQLite。
- `run-controlled.candidate.mjs`、`runner-config.candidate.mjs`、`runner-lifecycle.candidate.mjs`：仅在显式 `--enable --config` 且配置文件由 root 管理、服务组只读时尝试启动。可选手机号配置指定固定域名、短信签名/模板、ECS 角色、私有密钥位置和严格限额，不含密钥或凭据；缺省不开放手机号路由。不接受同步开关。需要已有受控 systemd socket 和证书。
- `production-phone-preflight.candidate.mjs`、`production-pnvs-outbound.candidate.mjs`、`ecs-metadata-transport.candidate.mjs` 和 `phone-*.candidate.*`：受控手机号 Worker 装配候选。默认关闭；显式配置时，对持锁运行者传入的 Miniflare/D1 校验迁移账本、结构和持久额度，再读取受保护的 Linux 私有 key 并构建仓库账号 Worker。短信请求经严格字段约束和固定阿里云 PNVS 出站；每日、每分钟、每号码发送与验证码校验各有硬上限。候选受控启动器在同一 D1 锁内切换 Worker、再次核验数据库后才开放固定 HTTPS 手机号路由。首次手机号注册、已有账号登录、重启及未知短信结果的处理仅经合成 Worker 和假供应商验证；尚未部署，也不构成可用的真实短信登录。
- `unified-d1-sync.candidate.mjs`、`production-sync-*.candidate.mjs` 和 schema 清单：同库会话校验及词汇、答题、打卡同步候选。服务端从账号会话确定用户，写入 SQL 同时复核会话；客户端提供的 owner 不能代替验证。启动预检校验 schema、迁移账本、独立密钥和模型摘要；遇到尚不支持的旧记录时关闭。

目前没有已部署的生产账号服务、经过真实运营验证的 PNVS 服务、审定的学习模型发布制品、生产数据库迁移/备份恢复、证书签发续期或经过实测的服务器配置；D1 锁与生命周期也未在目标 Linux 上实测。启用手机号前必须在同一数据库锁下完成预检、关闭旧 Miniflare 并重新打开同一持久库，不能只换 Worker 而放弃锁。启动 Miniflare 可能初始化未知目录的 SQLite 文件，schema 检查不能证明真实数据库身份或代替启动前备份。账号预检可识别审定的基础版和手机号版结构，但不会执行迁移。profile、题目标记、资料任务、录音和已有设备数据迁移均未覆盖。候选同步仅通过本地合成检查，不能用于判断任何真实账号已迁移或手机已能直连。接入前必须单独审查以上缺口，并在隔离环境与真机验证。

当前模拟测试中的私有构建器仅为测试临时暴露；正式模块不导出无预检的 Worker 构建入口。测试会暂时解除合成号码的本地重发窗口以验证重登，不更改每日总预算；没有调用真实供应商。遇到发送结果不明会隔离该号码、不会自动重发，仍缺可信的人工对账恢复流程；凭据预取失败也可能保守进入未知状态。真实 ECS 元数据、IAM、短信模板、预算、证书和国内直连都未验证。

当前 Miniflare 会自行处理 SIGTERM/SIGINT 并强制退出，不能用这两个信号声称优雅停机。受控入口监听 `SIGUSR2`；拟用 systemd 必须评估 `KillSignal=SIGUSR2`、`KillMode=mixed` 和足够的 `TimeoutStopSec`，以免启动初始停机信号同时送到工作进程。超时强杀或崩溃可能遗留锁，需要人工核验进程和数据库后恢复。以上配置和完整信号链尚未在目标 Linux/systemd 验收，不提供自动安装或清锁。

仓库内定向检查：

```sh
node --test server/cloud-candidate/*.test.mjs
```

测试使用临时或内存数据、虚构会话及假供应商，无外部服务连接；只证明被测约束，不代表云端和设备验收。
