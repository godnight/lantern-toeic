# 手工打开隔离 QA 模拟器窗口

当前 `LanternUIQA4d5098e7` 按启动 receipt 使用 `-noWindow`，所以没有 GUI 窗口。已归档的官方 CLI 帮助未提供把运行中的 headless 实例动态显示、附着窗口或 `show` 的命令；不能把再次执行 start 当作动态显示。可采用的最小路径是：先与协调者确认保存和验收工作完成，仅停止这个自有 QA 实例，再以同一实例路径保留数据启动，省略 `-noWindow`。以下仅是给用户的手工建议，本复核没有执行任何步骤。

## 三步操作

1. 先与当前验收协调者确认：最终包安装 / smoke 已完成，没有构建后待采集的证据、进行中的考试或尚未保存的练习 / 录音。由用户或协调者执行官方停止命令，只指定本次自有 QA 名称：

   ```powershell
   & 'D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\emulator\Emulator.exe' -stop 'LanternUIQA4d5098e7'
   ```

   只有确认这个 QA 实例成功停止后才继续。帮助中的 stop 语法仅列名称；若返回实例不存在、未停止或其他错误，不更改默认配置、不尝试其他实例名、不强杀进程，由协调者先核对该隔离实例的解析与状态。

2. 在 PowerShell 手工运行以下命令。名称、`instancePath`、`imageRoot` 和 HDC 端口沿用已验证的启动 receipt；`coldboot` 保留数据，末尾不带 `-noWindow`：

   ```powershell
   & 'D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\emulator\Emulator.exe' -start 'LanternUIQA4d5098e7' -instancePath 'C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-native-qa-jbv3rhze\instances' -imageRoot 'C:\Users\Administrator\AppData\Local\Huawei\Sdk' -bootMode coldboot -hdcPort 15551
   ```

   不使用 `reset`、`delete`、重新 create、`config`、`unset` 或 `force`。保留原 `imageRoot` 路径字符串；不将 C 路径改写为另一个镜像目录、不重建 overlay。此步骤不安装或升级应用。

3. 等窗口及系统启动完成，在模拟器窗口中手工打开「微光托业」。窗口未出现或命令报错时，保留输出并交给协调者核查；不要连续重复 start 或操作旧实例来替代它。能看到应用以后，四主题、搜索、返回、录音及学习流程仍需实际验收，窗口出现本身不计为 UI 通过。

## 官方依据与限制

依据为同目录 `official-emulator-help.txt`，SHA-256 `6bc912d975fcbcdc8ba33f222cdde7fdbe588d788f340740eb9b79595b8fb48e`：

- 第 2 行：start 接受实例名称及 `instancePath` / `imageRoot` / `bootMode` / `noWindow`；第 26 行说明 start 的作用。
- 第 27 行：`-noWindow` 的作用是 “Start the emulator without GUI window”。省略该标志使用普通启动入口；帮助没有动态切换当前运行窗口的选项，亦没有 `-noWindow false` 语法。
- 第 10、28 行：官方 `-stop <name>` 及其停止作用。
- 第 29–30 行：实例目录和镜像根目录参数。
- 第 33 行：`hdcPort` 范围 10000–16555，原端口 15551 在范围内。
- 第 55 行：`coldboot(boot with data)` 与 `reset(boot with data reset)` 明确区分。本建议只用 coldboot。

实例、路径、工具和 headless 启动身份来自 `start-receipt.json` / `plan.json`；操作边界与上一级 `SIMULATOR_CLI_QA.md` 一致：仅本次独立 QA，不操作 Offline7 / Content7 / Books7，不触及手机，不清学习数据，不修改系统安全、权限、网络或签名设置。

本复核未运行任何 Emulator / HDC 命令，未停止、启动、安装、触发 UI 或检查设备当前状态。后续协调者可能已升级候选或继续采样，所以执行前的协调确认必须以当时状态为准。
