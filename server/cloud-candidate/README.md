# 云账号与学习同步候选组件

本目录为隔离的审核候选，不含启动器、公开服务、部署脚本或真实配置。导入模块不会启动网络服务；手机号和同步都须显式启用。不要把这些组件直接部署到服务器，也不要接入真实账户或数据。

- `domain-policy.candidate.mjs`：HTTPS 域名格式和证书文件权限检查。证书签发、自动续期、网关及其启动器尚未入仓，实际 Linux 权限和 HTTPS 仍待验证。
- `production-phone-preflight.candidate.mjs`、`production-pnvs-outbound.candidate.mjs`、`ecs-metadata-transport.candidate.mjs`：手机号配置、迁移账本及限制检查，以及范围受限的阿里云短信请求和 ECS 元数据传输。手机号 Worker、可信令牌验证与生产装配尚未接入，不构成可用的短信登录。
- `unified-d1-sync.candidate.mjs`、`production-sync-*.candidate.mjs` 和 schema 清单：同库会话校验及词汇、答题、打卡同步候选。服务端从账号会话确定用户，写入 SQL 同时复核会话；客户端提供的 owner 不能代替验证。启动预检校验 schema、迁移账本、独立密钥和模型摘要；遇到尚不支持的旧记录时关闭。

目前没有生产账号 Worker、同库服务装配、审定的学习模型构建与发布输入、生产数据库迁移/备份恢复、证书守护或经过实测的服务器配置。profile、题目标记、资料任务、录音和已有设备数据迁移均未覆盖。候选同步仅通过本地合成检查，不能用于判断任何真实账号已迁移或手机已能直连。接入前必须单独审查以上缺口，并在隔离环境与真机验证。

仓库内定向检查：

```sh
node --test server/cloud-candidate/*.test.mjs
```

测试使用临时或内存数据、虚构会话及假供应商，无外部服务连接；只证明被测约束，不代表云端和设备验收。
