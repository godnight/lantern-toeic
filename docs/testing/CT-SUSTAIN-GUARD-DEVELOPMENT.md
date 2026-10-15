# CT r14：暂停准备后的持续推进门禁

日期：2026-10-15。开发负责人磐石；只在隔离树 `vocab-work/ct-sustain-guard-20261015/site` 修改音频控制器、聚焦测试及本专属文档。

## 身份与证据边界

- 分支：`fix/ct-sustain-guard-20261015`；基础提交：`e31588401f56ac34d89bcb428ccb85e5cc64f3c9`。
- 最终控制器 `lib/lesson-audio.ts` SHA256：`995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0`。
- r13 的 STATIC_FAIL、源码归档及历史 review 全部保留；r13 不因旧测试通过而获得安装/发布资格。其控制器 SHA256 为 `92511fccda5627add3809071a7148273d9a621a94970d43d9bd4daa82d360039`。
- 本轮未构建、未操作浏览器或设备、未冻结/提交/上传/push/合入/部署。root 独占设备及整包验证；这里的测试只证明受控事件模型中的控制器行为。
- r11 已有 Range，不把旧 r3 的响应历史作为本轮恢复失败根因；真实 ArkWeb 的暂停 seek 能力仍须关联事件与系统音流验证。

## 已证明的缺陷与修复

1. **旧进展配合静止时间冒充持续播放**：t0 建窗口，t200/400/600 前进，t800 同位置 timeupdate 原可确认。现在只有当前真正前进的 timeupdate 调用 accept；playing、play promise 与重复位置都不能确认。相邻真实推进必须间隔大于 0 且不超过 500ms；零间隔突发或更长间隔重建窗口。新窗口仍需至少三个推进、覆盖至少 750ms、足够媒体位移及同源/非暂停/非 seeking/位置合理检查。没有持续证据则 10 秒总超时并保留原点。
2. **seek 中 NaN 绕过短尾判断**：旧代码可能把 NaN 锁为 preparedDuration，再被有限时长恢复后的比较绕过。现在有效 metadata 时锁定有限正时长；ready、start、进展、accept、short-end 均重验有限正值及与锁定时长相差不超过 0.01 秒。start 不再锁现场无效值。确认后的 sample、普通 pause/ended 亦守确认时长，捕获入口不能保存时长突变后的点。
3. **起播后的非请求 seek 污染证据**：请求内新增 seeking 监听；仅当已经 start 且实时 seeking=true 才安全失败，保留原点。准备阶段的请求 seek 不受影响；晚到但 flag 已 false 的旧 seeking 不误终止。代次取消时移除该监听。
4. **短尾首点与 ended 突发**：除了真实 playing、有限一致 duration、正剩余时长且理论不超过 1500ms、未中断、真实前进与不同终点，还要求首推进后实际墙钟至少达到对应剩余媒体时间的 80%。首推进须在真实 playing 后 min(500ms, 理论剩余时长的80%) 内，且媒体位置不晚于余量的80%；ended 距最近真实推进不超过500ms。1秒音频先静止至1000ms、首次报.99、10ms后 ended 的已知反例被拒绝。
5. **短尾回调重入**：confirmed 回调若同步开启新请求，旧短尾在回调后重验 token/valid，不再用旧 stopped 清掉新代次。

## 保持的调用契约与准备条件

外部 API 未变；未新加诊断 stage/event/reason/field，不需修改宿主白名单。有限诊断仍区分 preparedPosition、firstProgressPosition/firstProgressElapsed 与确认时 current；延后确认点不是起播误差。

新元素或需 reload 的恢复仍先暂停 preload=auto/load，等新有效 metadata 后尝试暂停定位，即使 seekable 为空也不会永等范围；非零请求必须收到真实 seeked，且 seeking=false、同源、暂停与实际位置容差满足后才 play。currentTime setter 同步回显与 metadata 本身都不是定位成功。零目标自然在零可免伪造 seeked，随后仍须实际进展证据。未加入静音偷播、Blob 或 API 替换。

换源、显式 pause/stop/dispose、代次取消与超时保留已确认 checkpoint；准备中的点不写作成功。沿用的 DOM abort 边界须明确：fresh metadata 前的 load 可能发旧资源 abort，因此只记录并等待；metadata 后或起播后的 abort 失败。显式取消始终立即取消代次与计时器。

## 聚焦验证

最终命令：

```text
node --test tests/audio-resume-confirmation.test.cjs tests/lesson-audio.test.cjs tests/continuous-audio-ui.test.cjs
```

最终结果：**63/63 通过，exit 0**（控制器49、既有 lesson8、SpeechPlayer实际组件受控集成6）。原始输出保存在 `reports/ct-sustain-guard-audio-stable.log`。本轮文件 `git diff --check` 通过。

覆盖两条原始反例，500/501ms 边界、零时间突发与长静止重启窗口、NaN/Infinity/非正/变化时长、seeked 后 metadata 丢失、起播前后 seek、真实短尾/立即或伪 ended/迟到首点、确认后 capture/pause/ended 时长变化、回调重入；保留取消/换源/晚事件/卸载与错误后不污染点的原有覆盖。需要先 play 才能 seek 的模拟仍是预期安全失败，没有用隐藏播放解锁来制造通过。

负对照仅在内存中读取冻结 r13 控制器，运行 r14 两个原始反例测试；**两项均按预期失败（exit1，旧代码错误确认1次）**。证据 `reports/ct-sustain-guard-r13-negative-control.log`，旧文件未改。较早的54/61项日志仅为中间开发记录，不能作为最终源码验证身份。

## 交接与未验证边界

- 500ms 连续采样上限和短尾及时首推进要求会让事件稀疏的引擎安全拒绝；没有宣称所有短音频或短余量均可恢复成功。真实事件频率及 Chrome/ArkWeb 差异由新完整源码身份下的运行证据决定。
- 控制器只观察 Web 媒体事件与时间；无法由日志声称系统 renderer 或真实声音已持续存在。系统音流须由原生独立观测。
- root 继续在该 SHA 上完成全根类型/兼容、完整 Chrome、SDK 与真实 ArkWeb 首次非零暂停定位/正常重入/.85/中断矩阵。若暂停 seek 真实不支持，先据真实日志决定下一技术方案。
- 测试与静态复核均不代表用户批准、发布授权或设备验收；r13 STATIC_FAIL 记录不改写。
