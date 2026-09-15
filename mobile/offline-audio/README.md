# 鸿蒙内置练习语音

2026-09-15，从本项目原创题库及口语示范的原文合成 153 段 MP3，共 7,560,853 字节、930.246 秒。相同原文复用文件，覆盖 328 处播放引用：Part 1–4 听力、解析逐句回听、口语示范。未改写原文，也未使用 ETS 音频。

在本机通过 Windows `System.Speech.Synthesis.SpeechSynthesizer` 和已安装的 Microsoft Zira Desktop / en-US 合成 WAV，再用 FFmpeg 转为单声道 22,050 Hz / 64 kbit/s MP3。未复制语音引擎或 Windows 语音数据库，也未向外部服务上传文本。属于合成语音，不能称作真人录音或教师已审校的发音。

`manifest.json` 记录每段原文、引用、文本及文件 SHA-256、字节数、实测时长和生成工具。文件名是 UTF-8 原文 SHA-256 前 20 位。题库改动后构建会检查全部当前播放文本是否有对应音频；缺失或文件损坏会阻止打包。

这些文件仅由 `mobile/scripts/sync-audio.mjs` 复制进原生资源包，不进入 Web 的 `public/`。Web 继续使用设备系统朗读，鸿蒙入口注册内置语音，断网时无需系统英语语音包或在线合成服务。实际 ArkWeb 播放和真机扬声器输出仍需运行验证。

生成接口依据：[Microsoft SetOutputToWaveFile](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtowavefile)。语音供应商权利保留；本目录未单独声明音频采用题目文本的 CC BY 许可。

需要重生成时，在装有该英语声音和 FFmpeg 的 Windows 机器上运行：

```powershell
node mobile/scripts/prepare-audio.mjs
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File mobile/scripts/generate-audio.ps1 -InputPath reports/offline-audio/inputs.json
```

`RemoteSigned` 仅作用于此次 PowerShell 进程，不改变机器全局策略。生成器仅写入被忽略的 `reports/offline-audio/`；检查试听、清单和哈希后再将 `mp3/` 与 `manifest.json` 同步到本目录。同样原文会复用已生成文件，切换声音或生成参数时应使用新的输出目录。Linux CI 只验证已经提交的音频，不依赖 Windows 语音环境。
