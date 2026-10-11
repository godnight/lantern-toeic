# 专用模拟器的原生模考回归

`phone_mock.py` 验证实际 ArkWeb、系统文件选择器及原生下载链路；`scripts/verify-native-mock.cjs` 使用仓库当前 `exam-model.ts` 检查导出文件。只允许两套指定的原创合成 QA 题包，不用于用户学习记录或真实试卷。离线检查通过不能代表设备执行通过。

## 准备

使用已接受首次协议、已启动并已安装待验 HAP 的专用实例。脚本只接受明确的本机回环 HDC 目标，并核验实例名称及已安装 `versionCode`。它不安装、卸载、清数据、编辑私有数据库或修改时钟。不得与人工操作、其他设备 runner 或长时间计时观察并发。

准备两份 JSON：

- `page-packer-qa-only`：运行 `tests/fixtures/create-page-packer-fixture.py` 生成原创 PDF/20秒静音音频/recipe，再按 `docs/EXAM_PAGE_PACKER.md` 用真实 Poppler 打包。保留生成后的原字节。
- `browser-qa-alpha`：浏览器 QA 的 `qa-only-alpha.json`，或调用 `tests/fixtures/synthetic-exam.cjs` 并传入该 ID 生成独立结构题包。后者仅用于第二套导入，不用于本轮媒体预检。不得冒充完整练习卷。

将这两份**合成文件**放入已核实的公开 Download 子目录。准备动作与本测试分开；runner 仅通过 HDC 读取公开目录，不发送文件。先确认系统选择器显示的文件夹名称与该目录的对应关系。运行开始时 App 应在普通主页、训练页或题包目录；所有旧模考须已交卷。旧题包必须是相同两套 QA 文件，已有记录会保留。失败留下的未交卷记录不会被脚本自动覆盖，应先通过正常 App 流程处理，并保存该次失败证据。

创建仅存本机的 UTF-8 manifest；路径为绝对本机路径，哈希为对应文件**原字节**的 SHA-256 小写值，标题、版本必须与文件一致。以下是结构说明，尖括号内容需要替换：

```json
{
  "kind": "lantern-native-mock-qa",
  "schemaVersion": 1,
  "packages": [
    {"file":"<原页题包绝对路径>","sha256":"<64位小写SHA256>","deviceFile":"qa-only-pages.json","id":"page-packer-qa-only","version":1,"title":"<题包原始标题>"},
    {"file":"<第二套题包绝对路径>","sha256":"<64位小写SHA256>","deviceFile":"qa-only-alpha.json","id":"browser-qa-alpha","version":1,"title":"<题包原始标题>"}
  ],
  "examId":"page-packer-qa-only",
  "answers":{"1":0,"2":1}
}
```

`deviceFile` 是公开目录中的精确 basename，须满足 `qa-only-[a-z0-9-]+.json`。运行前先验证本地题包；运行后再次接收设备上的输入并逐字节核验 SHA。两文件内容不匹配即停止，不会导入。

## 执行与判定

在仓库根目录调用（Windows 示例；工具路径、实例和版本按实际填写）：

```powershell
python harmony/scripts/ui/phone_mock.py run `
  --device 127.0.0.1:5555 --instance LanternOffline7 `
  --cli '<deveco.ps1绝对路径>' --hdc '<hdc.exe绝对路径>' --node '<node.exe绝对路径>' `
  --manifest '<manifest.json绝对路径>' --expected-version-code 20006 `
  --export-dir /storage/media/100/local/files/Docs/Download/com.lantern.toeic `
  --folders Download 'LANTERN TOEIC' --out '<全新证据目录>' --dedicated-synthetic-qa
```

该参数明确允许在专用实例写入 QA 数据。脚本取得设备文件锁，默认总限时20分钟（最多30分钟）；它不能阻止不遵守锁的外部工具。未知权限框、锁屏、遮挡、断连或命令超时均保留失败，不会点击绕过。总限时按单调时钟计量，命令超时后不再发送新命令。崩溃留下的锁不会自行抢占，排查确认原进程退出后再由执行器处理。

链路为：初始目录/备份 → 两份真实选择器导入 → 实际备份确认旧历史保留 → 精确选择原页题包 → 图片和短音频预检 → 合成 QA 确认 → 第1题 A、第2题 B，等待保存完成 → B0实际导出 → 确认本轮新记录归属 → 冷启动并继续 → B1 → 原B0恢复两次，每次实际导出B2/B3。

API 26 选择器点文件即返回；旧选择器须在“已选1/1”后点一次“完成”。脚本按结构区分，不依赖旧坐标。作答按题号选项组定位，题包按标题与版本/来源定位。异步保存和退出分别等到后置状态再执行下一动作。

导出成功需要公开目录出现唯一新文件、两次接收字节稳定且模型校验通过。最终核对两包指纹、整份旧历史、本次唯一新记录及序号、两道答案和保存时间、起点与截止时间；revision/观察时间/驻留时间不倒退，旧中断保留。不能用整个备份字节相同来判定恢复幂等，也不能只凭成功提示。首次空目录的预期空备份会标为本地产生的 UI 断言，不冒充设备导出。

成功写 `result.json` 的 `status: passed`，退出0；执行失败退出1，启动条件不满足退出2。每条命令、布局和截图留在新证据目录，禁止将含设备信息或完整个人记录的原始证据上传公开仓库。短模式保留新的未交卷合成考试，不强行交卷或清除记录。

此短测试不证明真实听音、麦克风、物理机/折叠硬件、真实试题或两小时耐久。勾选试听确认仅让已知静音 QA 流程继续，不能记录成用户听音通过。

## 真实截止时间模式

在上述命令后加 `--observe-deadlines`，同一轮在 B3 校验之后继续等待原始45分钟切换和120分钟交卷。此模式限专用实例 `LanternOffline7`，默认及最大总预算为8400秒（140分钟），从整轮开始计量，包含导入、短回归、等待及最终导出；`--max-seconds` 可缩短但不能延长该预算。等待实际两小时是预期行为，不修改主机或设备时间来加速。

`mock_deadlines.py` 每30秒读取官方实例清单、可访问性布局和截图，不点击、不滚动。它必须先看到听力，再看到阅读及自动交卷结果；原答案数、标题和倒计时需匹配刚校验的 B3。阶段退回、未知遮挡、超过120秒的采样间隔、主机时钟跳变或截止后60秒仍无结果均失败。它临时收紧到原截止时间加60秒，结束后恢复父脚本的原剩余预算，不另开新预算。

看见结果后，父脚本从正常 App 页面导出最终备份，检查两次接收字节稳定，再调用 `--timeout-baseline B3 --final-backup FINAL`。最终校验必须证明同一条记录、两答案及原保存时间、原始起点/截止、旧历史均保留，且已持久化为 `submittedReason=timeout`、`submittedAt=readingDeadline`；真实模型计算该合成场景为0正确、198漏答。不会将尚未交卷记录在校验器内推进为交卷后冒充实际导出。

`deadline-observer.json` 的通过仅证明周期性可见 UI；单独的 Node 报告只验证调用方提供的 JSON。完整 runner 还须取得实际下载文件，最终 `result.json` 包含 `original-deadline-timeout-durable-backup` 才代表整条链路成功。周期性截图不能证明连续两小时全程前台；本模式也不证明真实听音或真题内容。最终保留已交卷的合成记录及原历史。

## 离线回归与 CI

```text
python -B -m unittest discover -s harmony/scripts/ui -p 'test_*.py'
node --test tests/native-mock-verifier.test.cjs tests/native-mock-timeout.test.cjs
```

Python fixture 回归纳入 Harmony CI，模型/备份反例纳入 Core 的 `test:study`。两者不连接设备。真实 run 只能在独占的 Windows 设备执行器运行，须保留其单独结果，不能用 CI 的离线通过替代。
