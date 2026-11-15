# 云账号与学习同步候选组件

本目录为隔离的审核候选，不含已部署服务、部署脚本或真实配置。导入模块不会启动网络服务；受控启动器必须显式启用，手机号和同步仍然关闭。不要把这些组件直接部署到服务器，也不要接入真实账户或数据。

- `domain-policy.candidate.mjs`、`https-gateway.candidate.mjs`：域名证书检查和受控 systemd socket 网关候选，仅显式启用后读取 root 管理的证书，检查 SAN、有效期、密钥、文件权限和系统信任链。实际 Linux socket/权限、真实证书签发及续期仍未验证。
- `auth-worker.ts`、`build-inputs.mjs`：从本仓库固定源码构建最小账号 Worker 和学习模型，只生成内存制品；不读取私人工作区，也不写出配置或凭据。构建需根目录依赖（当前使用锁文件内的 esbuild），尚未形成独立服务器发布包。
- `assembly.candidate.mjs`：账号与同步共用同一个受信 Miniflare/D1 的进程内分发，默认不接同步；不创建监听或服务。手机号仍使用产品中的未配置供应商，无法发送验证码。
- `service.candidate.mjs`、`https-handler.candidate.mjs`、`local-channel.candidate.mjs`：默认关闭的进程内组合、固定路由和临时 HMAC 信封。HMAC 不提供进程隔离；用户仍通过真实账号会话验证。关闭服务会等待已接收的请求结束；调用方应在服务关闭后再释放 Miniflare 和数据库锁。
- `d1-lock.candidate.mjs`、`locked-service.candidate.mjs`：锁定私有数据目录后才打开其下固定 D1 路径，并经只读 schema/迁移账本预检后接入服务；停机顺序为网关排空、运行时关闭、释放锁。进程异常残留锁不会自动清除。锁约束使用同一入口的进程，不防止其他程序直接操作 SQLite。
- `run-controlled.candidate.mjs`、`runner-config.candidate.mjs`、`runner-lifecycle.candidate.mjs`：仅在显式 `--enable --config` 且配置文件由 root 管理、服务组只读时尝试启动。配置只能指定精确域名、私网地址、数据库目录与证书位置；不接受凭据、短信或同步开关。需要已有受控 systemd socket 和证书。
- `production-phone-preflight.candidate.mjs`、`production-pnvs-outbound.candidate.mjs`、`ecs-metadata-transport.candidate.mjs`：手机号配置、迁移账本及限制检查，以及范围受限的阿里云短信请求和 ECS 元数据传输。手机号 Worker、可信令牌验证与生产装配尚未接入，不构成可用的短信登录。
- `unified-d1-sync.candidate.mjs`、`production-sync-*.candidate.mjs` 和 schema 清单：同库会话校验及词汇、答题、打卡同步候选。服务端从账号会话确定用户，写入 SQL 同时复核会话；客户端提供的 owner 不能代替验证。启动预检校验 schema、迁移账本、独立密钥和模型摘要；遇到尚不支持的旧记录时关闭。

目前没有已部署的生产账号服务、PNVS 生产 Worker 装配、审定的学习模型发布制品、生产数据库迁移/备份恢复、证书签发续期或经过实测的服务器配置；D1 锁与生命周期也未在目标 Linux 上实测。启动 Miniflare 可能初始化未知目录的 SQLite 文件，schema 检查不能证明真实数据库身份或代替启动前备份。账号预检目前不接受已经应用手机号迁移的库，后续接短信需要按版本扩展校验。profile、题目标记、资料任务、录音和已有设备数据迁移均未覆盖。候选同步仅通过本地合成检查，不能用于判断任何真实账号已迁移或手机已能直连。接入前必须单独审查以上缺口，并在隔离环境与真机验证。

当前 Miniflare 会自行处理 SIGTERM/SIGINT 并强制退出，不能用这两个信号声称优雅停机。受控入口监听 `SIGUSR2`；拟用 systemd 必须评估 `KillSignal=SIGUSR2`、`KillMode=mixed` 和足够的 `TimeoutStopSec`，以免启动初始停机信号同时送到工作进程。超时强杀或崩溃可能遗留锁，需要人工核验进程和数据库后恢复。以上配置和完整信号链尚未在目标 Linux/systemd 验收，不提供自动安装或清锁。

仓库内定向检查：

```sh
node --test server/cloud-candidate/*.test.mjs
```

测试使用临时或内存数据、虚构会话及假供应商，无外部服务连接；只证明被测约束，不代表云端和设备验收。
