# 合成账号备份演练

本目录只验证 SQLite 的单库在线备份机制，**不能用于迁移真实账号**。工具不接受源或目标路径；必须显式传入 `--run-synthetic`，之后才会在系统临时目录中新建 `lantern-synthetic-backup-*` 文件夹、自行生成两份虚构数据库，并保留该目录以供检查。它不会读取或修改旧账号服务的数据。

```sh
python tools/cloud-migration/synthetic_backup.py --run-synthetic
python -m unittest discover -s tools/cloud-migration -p 'test_*.py' -v
```

主库演练先保留一笔已提交、尚存在 WAL 中的记录，再在分页在线备份期间提交另一笔事务；分别备份主库和 metadata，使用 SQLite 在线备份恢复，检查每份数据库的完整性、同一库内的事务一致性及恢复后记录摘要。源数据库会保留。metadata 测试数据只是合成的，不模拟 Miniflare 的实际元数据行为。

主库和 metadata 各自备份，**不保证两库属于同一时点**。本地合成测试通过不代表生产数据可安全迁移或恢复；正式切换仍需识别所有写入者、停写并排空、设计跨库一致性检查，完成针对实际运行时的备份恢复验证。
