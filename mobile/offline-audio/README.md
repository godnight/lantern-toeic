# 鸿蒙内置练习语音

2026-10-11，v0.3.2 将原 448 段 MP3 扩为 1,015 段，共 18,749,095 字节、2245.643 秒。相同原文复用文件，覆盖 1,217 处播放引用：Part 1–4 听力、解析逐句回听、口语示范，以及 807 个场景词和现有题内表达的单词发音。新增 567 段对应本次扩词；未改写播放原文，也未使用 ETS 音频。

这些音频不覆盖 84,979 条通用英汉词典；未内置的查词发音仍依赖设备系统朗读。词库例句跟读及新增词助记尚未完成，不能将已有题目逐句回听算作这些功能。

在本机通过 Windows `System.Speech.Synthesis.SpeechSynthesizer` 和已安装的 Microsoft Zira Desktop / en-US 合成 WAV，再用 FFmpeg 转为单声道 22,050 Hz / 64 kbit/s MP3。未复制语音引擎或 Windows 语音数据库，也未向外部服务上传文本。属于合成语音，不能称作真人录音或教师已审校的发音。

`manifest.json` 记录每段原文、引用、文本及文件 SHA-256、字节数、实测时长和生成工具。文件名是 UTF-8 原文 SHA-256 前 20 位。题库改动后构建会检查全部当前播放文本是否有对应音频；缺失或文件损坏会阻止打包。

这些文件仅由 `mobile/scripts/sync-audio.mjs` 复制进原生资源包，不进入 Web 的 `public/`。Web 继续使用设备系统朗读，鸿蒙入口注册内置语音，已打包片段断网时无需系统英语语音包或在线合成服务。v0.3.2 / 20008 的两份 HAP 构建、1,059 项资源核对及官方签名验证通过，本轮未安装手机；用户手机仍为此前的 v0.3.1。

本轮完成合成、媒体解码与文件核对，未逐词人耳验收。离散单词缺少语义上下文，`record`、`graduate`、`delegate`、`permit`、`import`、`export`、`wound`、`coordinate`、`survey`、`entrance` 的异读或重音应优先试听，确认与词卡词性和目标义一致；清单表示待核验风险，不表示已发现实际发音错误。

生成接口依据：[Microsoft SetOutputToWaveFile](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtowavefile)。语音供应商权利保留；本目录未单独声明音频采用题目文本的 CC BY 许可。

需要重生成时，在装有该英语声音和 FFmpeg 的 Windows 机器上运行：

```powershell
node mobile/scripts/prepare-audio.mjs
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File mobile/scripts/generate-audio.ps1 -InputPath reports/offline-audio/inputs.json
```

`RemoteSigned` 仅作用于此次 PowerShell 进程，不改变机器全局策略。生成器仅写入被忽略的 `reports/offline-audio/`；检查试听、清单和哈希后再将 `mp3/` 与 `manifest.json` 同步到本目录。同样原文会复用已生成文件，切换声音或生成参数时应使用新的输出目录。Linux CI 只验证已经提交的音频，不依赖 Windows 语音环境。
