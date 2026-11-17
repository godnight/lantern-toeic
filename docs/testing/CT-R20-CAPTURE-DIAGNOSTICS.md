# CT-r20 采集观测范围

本轮承接r19已冻结的零时长提示修正。目的：在用户批准的一次新录音中区分实际dataavailable块（含零块）、停止与最终块、组合保存、真实原件解码和回放；不能借新样本替换旧ID的诊断。

`lib/recording-capture-diagnostics.ts`仅发送固定9键与固定事件/类型枚举。每进程最多128条；日志中没有音频、文本、原始MIME、ID、URL、路径或错误详情。ArkTS `NativeCaptureDiagnostics`对同一固定形状和边界再次校验，写LANTERN_CAPTURE；既有可信页面/pageReady门禁保留。

SpeakingRoom在既有开始/块/停止/释放/保存边界调用观察器；所有事件含零块，totalBytes是累计Blob.size，并非独立读取最终文件。日志异常受catch隔离。permission-error沿用原mounted/generation有效性条件，旧异步失败不会归到新的采集尝试。没有添加编码探测、转码、重试、删除、覆盖或新保存门禁。

检查范围包括有界字段/预算/异常和原生路由，以及真实Room受控多块、零块、queued final dataavailable、保存失败保留相同Blob/ID再保存、过期权限失败。FakeRecorder不代表真实编码器。实际单次硬件结果、原始文件SHA、PyAV检查、正常三域导出与有意新增单列在外层dev-native/private-diagnostics/data-audit；私有音频与学习导出不入源码包。

一次新样本若失败即保留首次状态并停止，不自动再次调用麦克风。停止后检查OS采集器与应用流，返回目录/今日/OS Home并核实安静。原件不改写、不转码、不上传；旧录音元数据仍是历史墙钟信息，不能默改成媒体时长。
