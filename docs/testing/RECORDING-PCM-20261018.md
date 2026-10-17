# 鸿蒙 PCM 录音候选（2026-10-18）

基于媒体 r20 `42ec27e8c6e41a04014e5a78a52befce7f97b1e7`。该候选绕过 ArkWeb MediaRecorder/Opus 的已观测异常封装路径；不声称已唯一定位系统输入、编码器或封装器中的首因，也不恢复此前已缺失的音频内容。

## 行为

- 鸿蒙内置网页使用已经获得授权的 MediaStream，经 Web Audio 单声道 PCM16 写入 WAV。没有新增麦克风申请，Web 仍用原有 MediaRecorder。
- PCM 时长来自实际样本数；零样本不生成“只有 WAV 文件头”的成功录音。采样时长明显短于录制墙钟时保留实际字节、显示完整性警告，并禁止把该次标为已完成的口语练习；保存重试、用户/页面隔离和旧录音保留原流程。
- 录音上限 120 秒、文件总量不超过 12,000,000 字节。常规 48 kHz 单声道约 96 KB/s。停止后立即断开源、处理节点及静音输出，关闭 AudioContext；调用方仍负责停止其 MediaStream tracks。
- WAV 文件名和 MIME 加入原生下载精确白名单，历史回听与当前录音的下载扩展名一致。现有本机 Blob 存储、备份 MIME 字段及上传 `audio/*` 合同兼容 WAV；没有迁移或改写旧音频。
- 录音播放器增加显式 0.75×、1×、1.25×、1.5× 回听速度。
- r20 采集计数诊断默认关闭。测试可显式启用原有脱敏、定额计数器；产品界面不暴露诊断开关。

使用 ScriptProcessor 是针对现有宿主的兼容实现：不增加动态 Worklet 模块/Blob CSP 依赖，且检测回调缺失。该接口已被 Web Audio 规范列为 deprecated，后续可在宿主验证通过后改用 AudioWorklet。参考 [W3C Web Audio API](https://www.w3.org/TR/webaudio/#the-scriptprocessornode-interface)。

## 已执行验证

- `npm run test:study`：711/711 通过，含真实源码 PCM 编码/资源释放/异常与原有保存、切换用户、后台停止回归。
- `harmony/tests/native-downloads.test.cjs`：12/12 通过，包含 WAV 的名字、MIME、来源边界。
- 类型检查通过；差异检查通过（沿用仓库 CRLF，`core.whitespace=cr-at-eol`）。
- `npm run test:recording:browser`：真实 Chromium 158、6 秒 440 Hz 合成输入、不请求麦克风。得到 573,484 字节/286,720 样本/5.973333 秒 WAV，RMS 0.1763；保存 IndexedDB 后 1× 完整回听，关闭页面后在同一浏览器存储环境新建页面，以 1.5× 从原 IndexedDB 回读完整结束，样本数和字节一致。
- 纯单元负向用例：6 秒墙钟仅 2,880 样本时保存真实 0.06 秒并提示不足；零样本不产生假成功；全长静音保留且不声称识别到人声。

首轮浏览器脚本错误使用了新的隔离 context，冷页面看不到前一 context 的 IndexedDB；改为同 context 新页面后通过，首败报告保留。首轮全量源码测试有两条旧 VM harness 未映射新 adapter 导入；补映射后同套 711 项通过。两者均没有改宽产品验收断言。

## 尚需独立验证

真实 Harmony ArkWeb 中的合成采集、WAV 解码/导出、0.75×/1×/1.5× 回听及冷启动、系统音频资源释放，由独立诊断 bundle 验证。真实手机麦克风输入及用户可听性仍需实际设备验证；桌面合成通过不代替真机。#47 不能仅凭本候选单测或开发浏览器结果整体关闭。

## 追加：完整 Speaking 页面与实际本机存储（2026-10-18）

`node tests/browser/speaking-capture-flow.cjs` 在独立浏览器 context 执行实际 SpeakingRoom、RecordingPlayer 和 useStudy；可用 `LANTERN_SPEAKING_SOURCE_REPO` 指向只读集成源码。没有模拟 PCM 编码或学习存储，只有 getUserMedia 返回已知振荡器流；所有测试记录均为该 context 中的新合成数据。验证前后核对 11 个源码文件 SHA256 一致。

7/7 场景通过：准备取消释放；手动结束后实际 WAV/元数据存入 IndexedDB/学习记录；UI 选择 1.5× 并回听到真实末尾；再次录音后模拟页面后台自动停存；保存失败保留 Blob、取消离开并下载、重试后下载与已存 Blob 的 SHA256 一致；明确放弃只释放未保存录音；关闭页面再新建页面，从原存储读回第一条录音，以 UI 选择的 0.75× 完整回听。测试不替 UI 写 playbackRate，原有录音的字节和元数据均保持。

此次完整页面测试直接读取 `lantern-site` 集成源码。结果在独立工作目录 `vocab-work/recording-fix-20261018/speaking-flow/2026-10-17T17-24-13.499Z/report.json`，7/7、无页面错误、无外部/API 请求、无真实麦克风调用。该测试覆盖口语功能链，不是整版网站/原生 App 验收；浏览器后台事件为受控模拟。
