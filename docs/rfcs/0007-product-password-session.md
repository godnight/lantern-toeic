# RFC 0007：统一产品身份与用户名密码会话

状态：本地实现中，未公开上线；2026-10-16。用户已明确先开发用户名密码、底层共用一套身份。基于公共本地分支 `6294c8902b5fe0a2ac881259ba9926eda0d8fbc4`，不合入媒体修复。

## 选型与边界（供架构审阅）

保留 Vinext、Worker nodejs_compat、D1/R2，不新增认证框架。现有依赖没有成熟身份服务库。使用平台官方 `node:crypto` 的异步 scrypt、timingSafeEqual、randomBytes，复用现有逐用户数据查询。Argon2 当前不被 Worker node:crypto 支持；采用 OWASP 列出的等价 scrypt 参数 N=16384、r=8、p=5（16 MiB），不自行实现密码学或降低测试参数。

- 稳定随机 `usr_` UUID 是唯一产品用户 ID；用户名规范值只用于凭证唯一索引。未来手机号 `(provider, issuer, subject)` 也绑定同一个 ID，绑定冲突禁止静默合并。当前无绑定/迁移写入口。
- 用户名只接受 3–32 个 ASCII 字母、数字、下划线，首尾空白去除后转小写；密码 15–128 个 Unicode 码点且不超过 512 UTF-8 字节，不截断、不 trim。随机盐与版本化强哈希入库，密码不记录或返回。
- 会话为 256 位随机 token，D1 只存 SHA256 摘要和 12 小时绝对有效期。HttpOnly/Secure/SameSite=Strict 的 `__Host-lantern-session` Cookie，无 Domain。注册/成功重新登录发全新会话并撤销同账号及该浏览器旧会话；不提供滑动续期或长期客户端令牌。退出服务端删除会话后清 Cookie。
- 所有私有 API 只认服务端查验有效会话得到的产品 ID；不认 Sites 身份头、X-Lantern-Owner、自报 userId、query token。X-Lantern-Owner 仅作账号切换保护。
- 登录/注册/退出和私有写入要求匹配 Origin，拒绝 cross-site Fetch Metadata；认证仅同源 JSON。固定运行时 origin，拒绝未配置、缺表及数据库故障；默认关闭，不降级至伪身份。未修改托管 ACL 或生产配置。
- D1 原子计数在 scrypt 前执行，覆盖全局和规范用户名固定窗口。未知用户走同成本 scrypt，错误返回通用提示。当前不信任自报 IP；发布前还需可信网关来源限流/机器人保护、容量和实际 CPU 预算验收。
- 同一 module/isolate 同刻最多一个真实 scrypt；hash/verify 共用槽位，没有等待队列，超额立即 429/Retry-After:1。槽位由真实 crypto 完成后的 finally 释放，客户端中断或 Promise 超时不能提前释放。它不能代替跨 isolate 分布式限流。
- 新账号只打开新分区；访客和旧 Sites 数据/队列保留、不复制、不自动归户。该分支不允许直接部署到旧私有站，因为旧 Sites 头不再认证。
- 无经过验证的邮件/短信/恢复码渠道，不能安全找回密码；当前没有密码重置接口或假成功 UI。可信恢复、密码修改和账号生命周期是发布前明确约束。

## 官方依据与替代方案

[Cloudflare node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)（2026-10-16读取）列出支持范围与 Argon2 例外；[Node scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) 提供官方算法 API；[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt) 列出所选 CPU/内存组合。成熟托管认证仍可后续通过同一用户 ID 适配，但当前服务开通/短信/凭据不是本地实现依赖。

## 适用范围与验收

本批交付 Web 同源会话与现有服务端数据路由纵切；原生仍本机保存，不把 Cookie 或秘密塞进 HAP。测试使用真实哈希、追加式 SQL 迁移、合成账号及隔离数据库/R2替身，验证注册唯一性、登录通用失败、并发限流、会话更换/退出/过期、CSRF、伪造头、A/B读写与对象访问、旧数据不迁移。Worker 哈希/数据库本地运行时另验，不把 Node 替身当生产集成。

未真实短信联调、未公开上线、未迁移个人数据、未创建外部账号或持久凭据。供应商/签名资质/预算仍待确认。
