# 合成账号备份演练

本目录只验证 SQLite 的单库在线备份机制，**不能用于迁移真实账号**。工具不接受源或目标路径；必须显式传入 `--run-synthetic`，之后才会在系统临时目录中新建 `lantern-synthetic-backup-*` 文件夹、自行生成两份虚构数据库，并保留该目录以供检查。它不会读取或修改旧账号服务的数据。

需要 Python 3.7 或更新版本，且其 `sqlite3.Connection.backup` 可用；当前 ECS 系统 Python 3.6 不能直接用于这项演练。

```sh
python tools/cloud-migration/synthetic_backup.py --run-synthetic
python -m unittest discover -s tools/cloud-migration -p 'test_*.py' -v
```

也提供独立 Node 实现，无 npm 依赖，已在 Node 24.13.1 本地验证；目标 ECS 可使用现有隔离 Node 运行时执行。该版本的 `node:sqlite` 会提示实验性，不能据此推断正式生产存储已就绪。

```sh
node tools/cloud-migration/synthetic_backup_node.mjs --run-synthetic
node --test tools/cloud-migration/synthetic_backup_node.test.mjs
```

主库演练先保留一笔已提交、尚存在 WAL 中的记录，再在分页在线备份期间提交另一笔事务；分别备份主库和 metadata，使用 SQLite 在线备份恢复，检查每份数据库的完整性、同一库内的事务一致性及恢复后记录摘要。源数据库会保留。metadata 测试数据只是合成的，不模拟 Miniflare 的实际元数据行为。

主库和 metadata 各自备份，**不保证两库属于同一时点**。本地合成测试通过不代表生产数据可安全迁移或恢复；正式切换仍需识别所有写入者、停写并排空、设计跨库一致性检查，完成针对实际运行时的备份恢复验证。

## Windows 在线备份审查候选

`online_backup_candidate.ps1` 是可审查的候选实现；目前只在全新合成数据库上测试，**不要据此操作真实账号库或切换服务**。入口默认关闭，要求显式 `-Enable`，并给出固定本地盘上的源根目录、两个相对于根目录的 `.sqlite` 路径、独立的目标父目录，以及 Python 3.7+ 的绝对路径。需要 Windows 和 PowerShell 7。内部 Python worker 不应直接调用。

候选的信任边界是当前 Windows 用户、SYSTEM 和本机 Administrators；这些主体视为可信。目标父目录必须已存在，所有者为当前用户，DACL 已保护且只允许这三个主体完全控制和继承。工具在其下以 Windows 独占创建新目录，设置并再次验证相同的受保护 ACL；不覆盖已有目录或文件。对源路径与目标路径逐组件持有 Windows 句柄并拒绝重解析点，对源文件拒绝硬链接；测试已检查持有句柄期间文件和目录不能重命名。

源数据库以 SQLite `mode=ro` 和 `query_only` 读取，不执行源 SQL 写入。为限制侧车路径竞态，当前实现要求每个源库的 `-wal` 和 `-shm` 在开始前均已存在且可安全打开，否则失败关闭；SQLite 正常协调这些文件是允许的。两个库分别在线备份，均通过 `integrity_check` 后记录各自开始/结束时间与 SHA-256 到 `manifest.json`；报告明确写入 `crossDatabaseAtomic: false` 与 `finalMigration: false`。每库备份有 30 秒期限。

失败时仅在新建目录 ACL 仍安全、所有对象属于已知文件名且不是重解析点或硬链接时，删除已知部分文件；空的私有目录保留。如果存在意外对象、ACL 改变或无法验证，就保留整个私有目录供检查。进程被强制终止时也可能留下私有部分文件；缺少完成的 manifest 不代表备份成功。完成的备份包含账号及凭据等敏感数据，不得提交仓库。

本地定向测试只建立并保留虚构临时库，覆盖中文/空格路径、独立 ACL 校验、WAL 并发写入、路径/硬链接拒绝、已有目标拒绝、失败清理和意外对象保留：

```sh
node --test tools/cloud-migration/online_backup_candidate.test.mjs
```

成功的热备仅用于单库快照与后续恢复演练；两个库的时间窗口可能不同。正式切换仍需要确认全部写入者、停写并排空、完成最终备份及隔离恢复核验，不能直接用此候选完成正式迁移。
