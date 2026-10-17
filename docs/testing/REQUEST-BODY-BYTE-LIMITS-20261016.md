# R-ROUTE-01 实际请求字节限额：限定修复交接

2026-10-16 UTC。小筑实现，小开统筹，dot转独立小测。状态仅 **FIX_DELIVERED_PENDING_INDEPENDENT_REGRESSION**。

隔离源码 `vocab-work/request-body-limits-20261016/site`，分支 `fix/request-body-byte-limits-20261016`，直接基于 F04 `67acbe94f6e4692bee52549e1e06484e5ea8f246`／tree `aacc25bd9771fa77b8c5eeb86d9f161e287d488f`。最终commit、tree、逐文件SHA与实际命令原件由项目根 `项目组/engineering/REQUEST-BODY-LIMITS-20261016/ENTRY.json` 绑定。

## 修复范围与读取合同

| 解析路径 | 实际上限 |
| --- | ---: |
| Study JSON | 200000B |
| Vocabulary JSON | 100000B，沿用数值，改为UTF-8字节而非JS字符 |
| Recordings multipart整体 | 13000000B；内部audio仍为原12000000B |

只新增小型 `lib/request-body.ts` 与三个路由解析前接线：鉴权→owner→Origin门禁仍先于读取；逐块累计byteLength，超过上限前不保留／复制该越界块，超限413并尽力取消，停止后续读取、释放本读锁。忽略不可信Content-Length，缺失／伪小不能绕过，伪大／非数值头也不替代实际计数。读取完整且未超限才聚合并用平台Response执行原JSON／text／formData解析。

空块不占保留数组；复制上限内块，避免生产者复用Buffer改变先前字节。取消失败或永不settle不覆盖413／拖住响应；读取异常503，完整读到但格式无效仍400。鉴权失败不触发reader或parser。上游仍可能一次交出一个大块，本实现不声称能限制传输层已经分配的那一块。

录音文件仅为HTTP表单解析入口接线。元数据校验、MIME／12MB文件规则、发生时间、R2 put、D1 insert／冲突和GET字节原样；没有录音采集／编码／播放改动，也不修同UID／ID覆盖或孤儿问题。题包96MiB R2已知长度流不变，原实际流行为待核范围不因此关闭。F04日期、旧数据无损与账号保护均保留。

## 开发证据

- `tests/request-body.test.cjs`：8项，有效边界／跨字节UTF-8／空块、首个越界后不再读、cancel拒绝或悬挂、读错／锁保全及Buffer复用。
- `tests/request-body-routes.test.cjs`：46叶用例，Node另计4个父组，TAP合计50。三路精确cap−1／cap／cap＋1、中文和emoji跨chunk、缺失／伪小／伪大／异常长度头、立即／中途读错、格式400、四类授权门禁及已有业务行／对象保全。另保留F04两日期门禁、既有audio文件限制及非等待取消。
- 原F04源码跑同一route测试：TAP50＝32通过／18失败；其中叶用例31通过／15有效RED、3个失败父组是汇总，不是18个不同漏洞。失败是旧状态／副作用／读错处理行为，没有新helper缺失或模块加载错误。
- 修复route首次TAP50／50；最终reader8／8，相邻7文件119／119（含F04两个新套件）、既有身份／Origin／owner／事件保护聚焦5／5。类型与差异检查单列，不合并为产品验收数。

前后首批结果保留，开发审查提出跳过0字节块的局部防御后，只增加一行skip及单元前后空块输入，最终helper与相邻回归另留FINAL原件，未覆盖FIRST，也未将重复用例重复累计。五份既有测试仅接入真实新helper依赖；两处录音表单fixture从假的formData函数改为真实Request／FormData，原业务断言保留。新route套件与继承的F04 UI套件允许显式source override，否则使用自身site，修正test:study未设override时的fixture加载；没有修改行为断言或F04生产代码。

全部只用本地合成数据、已有依赖。API/auth/crypto/SQLite为实际模块，D1/R2是内存I/O适配器，不是生产边缘／真实D1/R2、真实账号或真实录音测试；大字段也只是少量有界合成字节，不是压测。

## 独立QA入口

cwd为候选site，在小测自己的新证据目录记录命令／exit／stdout／stderr，先核最终commit/tree及源pins：

```powershell
$env:LANTERN_REVIEW_ROOT='D:\zzl\托业学习\vocab-work\request-body-limits-20261016\site'
& 'C:\Program Files\nodejs\node.exe' --test --test-reporter=tap tests/request-body.test.cjs tests/request-body-routes.test.cjs
```

原版负控保持route测试文件来自本候选，将source root改为原F04目录并使用候选route测试绝对路径；不要对旧版运行不存在的新helper单元以制造加载失败。外层 `runs/` 原件不得覆盖；一次性runner拒绝复用名字。

小测按三条解析路径的原失败、受影响字段／业务无副作用和F04保全独立验收；只能按范围决定关闭或退回。源码审查／开发自测不关闭R-ROUTE-01整体，题包流与R-ROUTE-02另保留。没有新Web/HAP，旧PUBLIC build identity不是此候选的构建身份；r20未移植。未安装依赖、构建、动真实数据／设备／mic／证书信任、上传、push、合入或部署。
