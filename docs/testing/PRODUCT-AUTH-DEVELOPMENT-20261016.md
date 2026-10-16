# 产品第二轮：统一身份与用户名密码本地交付

> 本文保留冻结提交1012096的交付范围与当时结果。后续审查发现的 AUTH-01、旧标签页身份复核及本机传输调查，见 [独立修订回执](AUTH-REVIEW-REVISION-20261016.md)；不要把下列594/34或原限流描述当作修订后的最新结果。

2026-10-16；开发自测回执，未独立 QA、未公开上线。对应 V2-03/04 的服务端纵切及用户新增的“先用户名密码、底层共用一套身份”授权。

## 分支与原始状态

- 独立 worktree：`D:/zzl/托业学习/vocab-work/multiuser-auth-20261016/site`
- 分支：`feat/multiuser-auth-20261016`
- 精确基线：`6294c8902b5fe0a2ac881259ba9926eda0d8fbc4`，原 `public-local-20261015/site` 仅只读检查，未修改。
- 交付提交以本文件所在本地提交为准：`git rev-parse HEAD`、`git show --stat HEAD`。未 push/merge。
- 未合入任何未验收媒体分支，未改 CT 冻结目录、模拟器 15551、麦克风或真实学习数据。
- 本轮不制作发行 HAP；版本清单与历史候选标识保留。Web 构建仅验证源码可构建，不能当新的公开发行制品。

原有 `server-auth` 仅直接读 Sites 身份头；四组 API 已有按 UID 的 D1/R2 过滤及 X-Lantern-Owner 账号切换保护。客户端已有按 owner 分区、迟回取消和队列归属检查。本批复用这些逻辑，没有再造学习存储或自动迁移。

## 实际改动

| 文件/领域 | 变化 |
| --- | --- |
| `lib/password-credential.ts` | 官方异步 scrypt、随机 16 字节盐、固定 `N=16384,r=8,p=5,k=64`、恒时比较；严格版本化 hash；ASCII 用户名规范化；15–128 码点密码，保持空白，不截断 |
| `drizzle/0004_product_auth.sql`、`db/schema.ts` | 追加 auth_users、password_credentials、sessions、rate_limits；随机 `usr_` UUID 为稳定产品 ID；未改旧学习行 |
| `lib/auth-service.ts` | 真实注册/登录、D1 会话摘要、通用失败提示、输入体限额、同源检查、原子限流；登录换新 token 并撤销旧会话；退出服务端撤销 |
| `lib/server-auth.ts` 与四组私有 API | 只认有效服务端会话，固定 origin；忽略伪造 Sites/用户身份头、query userId 和客户端 owner 归属；X-Lantern-Owner 只核身份切换 |
| `app/api/auth/{register,login,logout,session}` | 实际认证端点，默认关闭；未配置/缺表/DB 故障不创建成功会话 |
| `/account`、账号中心 | 真实注册/登录/核对/退出，服务关闭可继续访客；成功才整页切换，失败/取消保持身份；原生暂不启用；不存浏览器长期 token |
| `lib/phone-number.ts` | 共享版本 1 的 +86 解析；无发码、验码或绑定成功分支。手机号未来仅作为同一产品用户的另一凭证 |
| 录音 API | 既存他人全局 ID 在写 R2 前拒绝；并发跨用户冲突只清本用户对象，返回 422，不改他人行或对象 |
| 测试/脚本 | 新增真实原语、实际路由/SQLite、workerd/D1 测试，纳入 `test:study`，另提供 `test:auth`；更新录音旧桩以适配新增授权检查 |

## 契约与复现

先读 [RFC 0007](../rfcs/0007-product-password-session.md)。无需外部账号、短信、秘密、网络调用或真实用户：

```powershell
Set-Location 'D:/zzl/托业学习/vocab-work/multiuser-auth-20261016/site'
npm run typecheck
npm run test:auth
npm run test:study
npm run validate:content
npm run validate:art
npm run build
node --test tests/*.test.mjs
git -c core.whitespace=cr-at-eol diff --check
```

`test:auth` 共 36 项（原语 10、真实路由 25、workerd 1）；`test:study` 总 594 项；构建后 mjs 共 34 项。最终结果另记在本机忽略目录 `reports/auth-study-final.log`、`auth-build-final.log`、`auth-mjs-final.log`，不把环境日志提交为公开内容。

本机离线 npm cache 缺一份已锁定包，`npm ci --offline` 未成功；随后只从同基线的原 worktree 只读复制已有 node_modules，未执行下载或来源不明脚本。两份 package-lock SHA256 完全一致：`9f53872e22114cec01bda5d6dafef7f75a700f61582b72c2f9c3af2c1317e4bc2`，未改锁文件或增加依赖。新环境依照根锁文件安装依赖后执行上述命令。

### 真实本地验证层级

- 原语测试使用 Node 官方 crypto，验证正确/错误密码、独立随机盐、hash 格式篡改、Unicode 边界和号码等价输入/拒绝输入。
- 路由测试实际加载 server-auth、认证服务、四类私有路由和真实 D1 Drizzle adapter；SQLite 内存执行全部迁移。仅环境/存储传输替身，没有 mock userId 或伪登录函数。
- A/B 覆盖：作答、手记、目标、题目标记、资料任务、词卡事件、录音、私人题包的读写/猜 ID/删除；旧事件 ID 碰撞与关联另一用户 checkin 被拒。旧 guest/device/username/Sites 数据逐表保留，新增账号没有继承。
- 会话覆盖：随机 cookie 只存摘要、规范名并发唯一、错误/未知用户通用失败、成功重登轮换、退出/过期/篡改/重复 cookie、缺配置/缺表、伪造身份头、自报 userId、CSRF 与固定 origin、原子限流。
- 本机真实 Miniflare `4.20260515.0` / workerd `1.20260515.1`、nodejs_compat、内存 D1 执行全部迁移和真实密码/会话流程；哈希字节与 Node 官方 scrypt 独立推导一致。完整强参数未在测试中降低；本机注册/登录粗测约 0.1 秒量级，不代表生产负载或费用评估。
- 原有学习、离线队列、身份迟回和媒体相关自动回归继续通过；未用这些测试冒充原生设备或人耳验收。

### 默认关闭与请求合同

运行时必须同时存在 `DB`、字符串 `LANTERN_AUTH_ENABLED=true`、精确 HTTPS origin `LANTERN_AUTH_ORIGIN`，否则认证返回 503，私有路由返回 401。没有可用固定码、开发身份、自报 UID 或外部 provider fallback。当前仓库未配置这些生产开关。

注册和登录为同源 JSON POST `{username,password}`；未知字段包括 userId 一律拒绝。会话通过 HttpOnly/Secure/SameSite=Strict、Path=/、无 Domain 的 `__Host-lantern-session`；令牌 256 位随机值，服务器只存 SHA256 摘要，12 小时绝对过期。登录成功会撤销同账号旧会话（包括其他设备）及当前浏览器旧会话。退出失败不显示已撤销。GET session 返回稳定 ID、规范用户名及真实能力；没有 password reset/phone/bind 端点。

私有 mutation 除有效 cookie 外，要求匹配 Origin 和 X-Lantern-Owner，拒绝跨站 Fetch Metadata。读取和写入都按已验证的稳定 ID 查询；用户名、手机号和客户端 ID 都不决定记录所有权。前端 owner 的格式只用于展示，不能认证。

限流：D1 原子用户名桶每 15 分钟 5 次，先于全局昂贵操作预算（100 次，注册另限 20 次）；坏输入不花共享预算、耗尽的用户名不继续消耗全局额。另有单 module/isolate 最多 1 个在途真实 KDF，hash/verify 共用；无等待队列，超额快速 429/Retry-After:1，真实 crypto 结束后 finally 释放，不通过超时 race 提前释放。全局预算是保守容量熔断，仍会受多用户名耗尽影响，不代替来源风控。当前不信任客户端 IP 头；公开发布前必须接可信边缘来源限流、机器人/注册滥用保护及容量评估。限流清理保留 24 小时，window_start 索引支持过期清理。

手机号规则 v1：仅 11 位、以 1 开头的本地号码，或完整 `+86` 前缀；接受明确的 ASCII 空格/短横分隔，输出唯一 `+86` 数字串。拒其他显式国家码、裸 86、0086、Unicode 数字、隐藏字符，不拆国家码或截断强行接受，不另造前缀白名单。该格式通过与手机号归属验证完全分开。

## 架构三项门槛回应

已读取外层 `项目组/architecture/USERNAME-PASSWORD-BOUNDARY-20261016.md`（ARCH-USERPASS-v0.1）。

| 门槛 | 本批证据 | 明确保留的发布条件 |
| --- | --- | --- |
| AUTH-G1 运行时与预算 | 真实本机 workerd/nodejs_compat、兼容日 2026-05-15、D1 全迁移、强参数哈希/验证及 Node 字节交叉核对 PASS；本机墙钟结果可复现 | 真实 Sites/Workers 宿主的计费 CPU、实际配额、进程/isolate 峰值内存和生产负载 NOT_RUN。理论 scrypt 工作区约 `128*N*r=16 MiB`，64 MiB maxmem 是单次调用配置，都不是整 isolate 测量。未知预算时保持关闭，不降低参数 |
| AUTH-G2 同刻昂贵工作 | Node 实际 crypto 与 workerd 同 turn Promise.all 3 次派生均只有 1 成功、2 个忙错误，真实 crypto 结束后可恢复；路由在途负例 429/Retry-After:1 PASS | 单 module/isolate 保护不跨实例，不证明跨请求调度/全局容量；可信边缘来源、短窗口突发及共享预算恢复策略仍为发布门槛 |
| AUTH-G3 全入口反证 | 25 项真实路由/SQLite 测试含所有私有路由的伪头/无会话/失效/撤销/DB 故障矩阵、A/B对象隔离、真实事务失败回滚 PASS；DB失败不产生登录/退出假成功 | 真实浏览器 A/B 独立 QA 与公开宿主链路 NOT_RUN；已有在途业务可能按当时捕获 owner 完成，不承诺追溯取消 |

以上关闭的是本地代码与限定测试层级；没有取得生产启用批准，也没有调用真实宿主做账号、配额或权限配置。

## 未交付与真实服务待办

1. **未真实短信联调、未公开上线。** 供应商、企业/短信签名与模板资质、处理地区、预算与限额仍待用户确认；未开外部账号、持久凭据、付费服务或公开部署。
2. 手机号未来绑定 `auth_users.id`，服务器验证归属和 provider 身份后建立唯一凭证关系；不同账号绑定冲突须停止并明确处理，不能静默合并。当前无绑定写入口，也不借用户名/号码认领历史。
3. 找回密码没有可信短信、邮件或恢复码渠道，当前不支持。公开发布前须设计并验收可信恢复和账号生命周期；不能凭用户名直接重置。密码修改/多设备管理也未提供。
4. 鸿蒙仍是本机记录；原生安全令牌存储与 HTTPS transport、登录 UI 和真机测试未做。Web 新账号的计划/训练/模考不因 Study 成功而变成全量云同步。
5. 访客、旧 Sites 和已有个人数据均未自动迁移；跨账号认领/导入/恢复必须另按预览、证明、明确选择和幂等合同实现。未提供云账号删除。
6. 录音本次修复仅跨用户 ID 冲突；同一用户的同 ID、不同内容重放及 R2/D1 完整一致性状态机仍待独立工作，不声称全媒体同步安全验收完成。
7. 可信边缘限流、恢复渠道、公开内容允许清单、生产容量/备份/回退、真实浏览器视觉与无障碍、真实平台/设备验收均是公开前门槛；本批未修改 ACL、部署或生产权限。
8. 此分支**不能直接覆盖旧个人站点**：原 Sites 身份头不再参与产品认证。旧分支/数据保留；未来需独立干净存储环境和发布授权，或经明确证明的迁移合同。可本地回退源码，但不删新增表或改写原数据。
