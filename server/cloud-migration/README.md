# 旧账号账本合成迁移演练

`legacy-auth-rehearsal.mjs` 只在内部新建内存 SQLite，不接受数据库路径、现有连接、账号或凭据。演练校验已审定的旧账本和账号结构，通过 SQLite changeset 逻辑复制虚构记录，在独立内存副本的单个事务内将旧迁移编号映射到当前编号；失败时回滚。它验证虚构账号、密码、华为绑定、会话和账号隔离保持一致。

```sh
node --test server/cloud-migration/legacy-auth-rehearsal.test.mjs
```

这不是生产备份或迁移工具：没有读取真实库、复制文件、处理 WAL 或 Miniflare 的 `_cf_METADATA`，没有证明账号数据库和元数据库的跨库一致性，也没有验证实际服务器凭据或真实华为服务。旧库停写、备份和恢复、真实结构及数据库身份、增量迁移、异常恢复与切换仍待独立完成；不得将此演练用于生产。
