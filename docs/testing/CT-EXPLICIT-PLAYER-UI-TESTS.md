# r15 显式新建媒体元素：组件回归

本轮只修改 `tests/continuous-audio-ui.test.cjs` 与本文档。测试实际加载已交付的 `app/learn/practice.tsx` / `SpeechPlayer`、`lib/explicit-bundled-playback.ts`、原 `lib/lesson-audio.ts`，不复制或替身 wrapper / checkpoint 算法。React hooks、DOM、媒体事件和 TTS 为确定性 fixture；不运行浏览器、设备、SDK，不修改 runtime 或 Git。

```text
node --test tests/continuous-audio-ui.test.cjs
```

## 原六项意图保留

保留 latest-sentence global-stop、静默恢复与 Continue/replay 区别、旧 TTS cleanup 不取消新源、未确认坏源不得写零覆盖好源、metadata 前暂停/后台取消、卸载先清 ref 后仍保点。两项 TTS 不改成 bundled；静默恢复在真正显式动作前不创建 Audio。

DOM 改为 `document.createElement('audio')` 工厂与实际组件隐藏 span host 的 ref/appendChild。每个组件保存全部 Audio identity 历史，document 仅查询仍连接的节点；补 src removeAttribute、load 取消代次、remove 与 listener 队列语义。下一次工厂可配置延迟 metadata 或 play 拒绝，避免把故障施加在已退休旧元素上。

## 新增行为边界

- 每次明确 Continue/replay 恰好创建一个 Audio；暂停、无关 rerender 不创建或替换节点，旧资源回收可观察。
- 退休 lease 的晚到事件与已排队旧回调不改变新源、位置、错误状态或 checkpoint owner。
- 失败 replay 在新的确认前保留旧正数点，后续成功 replay 才提交新的近零正向播放点。
- 同源 rerender 更换 onCheckpoint 后，当前确认/tick/pause 使用最新父回调，节点不重建。
- 旧 source cleanup 只写自己的来源/回调；额外控制延迟清理队列，直接执行实际旧 effect cleanup，确认不能处置或写入新的 controller。该对抗调度是 unit fixture，不声称 React 正常 commit 总以此顺序执行。
- native suspend、pagehide、visibility、录音复用的共享 global-stop 路径均保点；TTS 边界继续覆盖。这里没有实际录音或系统生命周期验收。

## 结果与保留的失败历史

2026-10-15 先后执行两次相同命令。两次之间测试文件和断言没有修改；第二次由已定位的组件源码修复触发，不是重复运行选取通过结果。

| 次序 | 实际组件 SHA-256 | 结果 | 含义 |
| --- | --- | --- | --- |
| 首次 | `88ade6b587b1b379c8c3b99d10e312912d19e57e9d1a85faaed49124c669a01c` | 12/13，exit 1 | 换来源/track 后首次点击未创建新 Audio；实际组件未清除旧 `playingRef` / `playing`。 |
| 修复后 | `b06a76bedb0b017876535463a37d98fc57529d85406e0b1334792167afd4b0a2` | 13/13，exit 0 | 新身份 effect 重置播放 ref/state 后，同一断言通过，包括实际旧 cleanup 延迟执行的对抗场景。 |

首轮控制台失败记录摘录保留如下。原音频对象已经释放（`src=''`、`removed=true`、`plays=1`），首次新来源点击仍返回历史同一对象，未调用新来源的 factory。测试不以再次点击规避该失败。

```text
✖ old scope cleanup captures only its own source and cannot retire or write the new controller
ℹ tests 13
ℹ pass 12
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1099.0669
AssertionError [ERR_ASSERTION]: Expected "actual" not to be reference-equal to "expected":
Audio [EventTarget] { _src: '', _time: 0.75, currentSrc: '', duration: NaN,
  id: 1, loads: 2, paused: true, plays: 1, readyState: 0, removed: true, removes: 1, ... }
  at TestContext.<anonymous> (.../tests/continuous-audio-ui.test.cjs:91:449)
operator: 'notStrictEqual'
```

修复后完整 13 项均通过，最终汇总原文（省略逐项耗时）：

```text
✔ only the latest played sentence captures on global stop; old mounted players cannot overwrite it
✔ native checkpoint restoration is silent; pause/resume and explicit restart keep distinct positions
✔ old TTS cleanup never cancels the newly started source
✔ an unconfirmed new bundled source cannot replace the last valid track with zero
✔ unconfirmed native resume can be cancelled by pause or background before metadata
✔ React unmount clears the DOM ref before cleanup without erasing a confirmed bundled checkpoint
✔ one factory call per explicit action; rerenders keep the current node and old resources are released
✔ late retired lease events cannot change the new node, position or checkpoint owner
✔ failed explicit replay preserves the prior positive checkpoint until a later replay confirms
✔ same-source callback updates use the latest parent without creating another Audio
✔ old scope cleanup captures only its own source and cannot retire or write the new controller
✔ confirmed bundled native background, pagehide, visibility and recording global stop preserve the point
✔ TTS native and pagehide boundaries stop only the active sentence and invalidate its late completion
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1117.9884
```

最终输入字节核对：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `app/learn/practice.tsx` | 31703 | `b06a76bedb0b017876535463a37d98fc57529d85406e0b1334792167afd4b0a2` |
| `lib/explicit-bundled-playback.ts` | 4543 | `5690e49f40217b1976909ede026c64bb46b13bd0d49830405e894f9f130b072a` |
| `lib/lesson-audio.ts` | 18213 | `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0` |
| `tests/continuous-audio-ui.test.cjs` | 19813 | `bef140e1e0dd65497eb2366bc7fae2be26f38361af02ab15e02a820fc0297d8c` |

这是组件与真实 wrapper/controller 组合的确定性行为回归。fixture 的 Audio、事件、时钟、TTS 与 hooks 不构成真实 Chrome 媒体、ArkWeb renderer、系统生命周期、真实录音或设备验收证据；“native”边界仅调用实际组件订阅的 native-state 回调。global-stop 验证的是录音共用的停止机制，没有进行真实录音。现有旧六项意图全部保留，未通过放松断言解决源码问题。本任务没有修改运行时、操作设备或提交源码。
