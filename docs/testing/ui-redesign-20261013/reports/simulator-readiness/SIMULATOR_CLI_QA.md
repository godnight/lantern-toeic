# 新隔离实例的官方 CLI 验证

2026-10-13。本轮已实际完成独立实例创建、系统启动、未签名历史候选首次安装、Ability 启动与单独应用冷启。源码仍在继续修订，所以这里只验证工具和历史候选的启动通道，不是最终 HAP 或界面验收。

## 实例与实际证据

- 名称：LanternUIQA4d5098e7。
- 独立实例目录：C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-native-qa-jbv3rhze\instances。
- imageRoot 保持原字符串：C:\Users\Administrator\AppData\Local\Huawei\Sdk。
- 明确 HDC 目标：127.0.0.1:15551。未选择默认或物理目标。
- 证据：本目录 native-qa-LanternUIQA4d5098e7。
- 当前协调状态：实例仍运行，供 root 最终候选在这个空白自有 QA 环境继续验证；后续可仅关闭此自有实例，保留虚拟盘和证据。

官方 Emulator.exe -help 明确列出 create/start 的 instancePath、imageRoot，start 的 noWindow，coldboot 表示保留数据启动；hdcPort 为 10000–16555。完整原文已保存在 official-emulator-help.txt。未执行 config/unset、reset、force、镜像下载、旧实例复制、旧 overlay 修改或系统安全设置。

实际命令（准确工具路径见 READINESS.md）：

~~~text
Emulator.exe -create LanternUIQA4d5098e7 -deviceType Phone -osVersion "HarmonyOS 7.0.0(26.0.0)" -instancePath <上述独立目录> -imageRoot <原C字符串> -storage 6 -memory 4 -hotBoot true
Emulator.exe -start LanternUIQA4d5098e7 -instancePath <上述独立目录> -imageRoot <原C字符串> -bootMode coldboot -hdcPort 15551 -noWindow
~~~

create.log 实际成功退出 0，new-instance-after-create.json 核对唯一名称和路径。start-receipt.json 记录自有进程 57192；引擎确认 Windows Hypervisor Platform accelerator operational。HDC 接通后 bootevent.boot.completed=true，const.ohos.apiversion=26，software version=emulator 7.0.0.106(SP1DEVC00E999R4P11)，const.ohos.fullname=OpenHarmony-7.0.0.105。

start.stderr.log 有 DirectSoundCapture 无声卡告警；它未阻止本次启动，不能据此声称真实麦克风可用。启动期间没有待审批请求或自动审批拒绝。

## 首次未签名安装与签名边界

使用 09:03 历史候选 44,282,830 字节 HAP，安装前再次核对 SHA-256：
1fa43622e1c740d76a943889de69b9778d5466dc0892f0be3be7765655cccb8a。

精确新实例中执行 hdc -t 127.0.0.1:15551 install exact-HAP，未使用 -r、-g、签名检查绕过或调试安全开关。实际返回 install bundle successfully / exit 0。安装前不存在该 bundle；安装后 bm dump 结构核对 root 与 applicationInfo 均为 com.lantern.toeic，0.3.3 / 20009，compatible/target API 12，appProvisionType=debug、debug=true。

此结果证明本机该 SDK26/系统 API26 开发模拟器可以直接接受这份未签名包。不能据此推导商业手机或发行包的签名规则。没有读取/生成私人签名、证书、AGC 凭据或执行权限授予。

boot-install-identity-proof.json 绑定实例、目标、系统版本和安装身份；install-receipt.json 绑定实际 HAP 哈希及命令。

## 官方应用生命周期 smoke

aa help/start help 原文确认 -b bundle、-a ability、-m module；没有添加调试标志。

~~~text
hdc -t 127.0.0.1:15551 shell aa start -a EntryAbility -b com.lantern.toeic -m entry
hdc -t 127.0.0.1:15551 shell aa dump -r
hdc -t 127.0.0.1:15551 shell aa dump -a
hdc -t 127.0.0.1:15551 shell hilog -x -P <已核实的该app PID>
~~~

首次 start 成功，PID7678 在多次采样持续存在；app/Ability FOREGROUND、ready1。有效日志中主 HTML/CSS/JS 全部 200、DOMContentLoaded、PageEnd200、表面 1256x2526、有绘制记录。随后仅对这份自有 QA 应用执行官方 aa force-stop com.lantern.toeic，再正常 start，新 PID8051，冷启也有相同主加载结果。

独立 native-log-review.md 对两次有效日志逐行复核。首次 FCP/FMP852ms，冷启485ms，仅是单次观察，不能当性能基准。没有明确应用 JS 异常、致命信号或 renderer 崩溃记录；保留 30 条平台 E 级初始化消息，不写成“零错误”。

首个 hilog -x 同时带 -z 的查询被 CLI -31 拒绝，失败文件保留；修正为官方支持的 -x 非阻塞读取后获得有效日志。force-stop 没有单独 -h 帮助，它把 -h 当不存在 bundle，查询失败未停止应用；后续依据 aa 总帮助的真实语法只停止准确 QA bundle。失败均不计为应用通过或应用缺陷。

## 仍需核实

两次启动分别有两个 text/plain、26 字节子资源 404，日志掩蔽了 URL。其形态与原生 rawfile 缺失回包一致，但路径和影响未知，不能猜成 favicon、字体或无害文件；主 CSS/JS200 不代表全部子资源成功。独立审查和 lifecycle-smoke-proof.json 保留此项。

全程未使用 HDC input、UI bridge、DevTools/隐私开关、权限/网络/系统安全变更，也未读取真实学习数据。没有向旧 Offline7/Content7/Books7 实例发送启动、安装、停止或数据命令；这不是旧记录逐字节审计。

当前 CUA 无原生 UI 控制通道，且本轮明确不使用替代 UI bridge。因此截图、真实控件布局、导航、四主题、搜索、录音、练习、模考和返回顺序均未完成原生交互验收。现在可以确认的是非破坏性官方创建/启动/安装/应用冷启通道可用，无签名或审批阻塞；后续在 root 再次冻结后重新构建，仅对这个 QA 实例保持数据正常升级，并另验最终源码与交互。


## Final frozen candidate upgrade (10:09 UTC)

The exact final HAP d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573 was upgraded using install -r only on LanternUIQA4d5098e7 / 127.0.0.1:15551, then AA initial and cold starts passed (PID 7949 then 8038). See FINAL_NATIVE_RESULT.md and final-smoke-build-lantern-ui-v11-knsxbchb-100923 under this instance evidence. Current limitations remain two masked 404s per launch and no native UI interaction. No simulator stopped or visibility switched.
