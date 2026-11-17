# 第二阶段主题素材

本目录只保存既有已确认素材的原样副本。`ASSET-MANIFEST.json` 记录源图指纹、各档尺寸和本目录运行资产 SHA-256；没有生成新角色、AI 放大或二次有损转码。

- 12 份 `*-hd-{1,2,3}x.webp`：来自冻结 `交付/界面方向-S1-r3-20261014/demo/assets`，与 10 月 14 日高清清单逐份核对一致。既有原 PNG 来自用户提供的 AI 同人素材，源文件名、尺寸、指纹见清单。各档均为 Lanczos 缩小，Pillow WebP quality=90、method=6。
- `knight-icon-{48,64,96,256}.png`：来自 `交付/小骑士图标补交-20261014` 用户已批准版。来源为既有 K01《德特茅斯·灯下休憩》场景，经先前独立图标工作编辑；本阶段原样复制，没有改形象或添加 TOEIC 字样。鸿蒙 `app_icon.png` 与 256 版逐字节相同。
- `legacy-app-icon.svg`：原有鸿蒙图标备存；不作为新图标加载。原生资源保留 `$media:app_icon` 名称，使用 PNG 替换 SVG，避免同名资源冲突。

用户已批准当前图标与两主题用于本地第二阶段实现；该批准不意味着游戏角色、同人源图或衍生图标具有公开发行或源码再分发许可。公开推送或发行时，应由整合负责人单独核定目标与素材范围。

背景使用 1× fallback 与 CSS `image-set` 的 1×/2×/3×，雨城只绘制至 300 CSS px。`ThemeScene` 完整图窗使用宽度 `srcSet`、响应式 `sizes` 和最大 560 CSS px，不裁切角色、洞顶、瀑布或倒影。DPR 3 使用源尺寸上限，不伪称无限高清。背景装饰与完整图窗分别展示，题目与词卡正文保持独立不透明表面。

共享 React API（`app/learn/ui-theme.tsx`）：

```tsx
<ThemeScene theme={state.profile.theme} />
<ThemeScene theme={state.profile.theme} scene="dirtmouth" caption="这段旅途，可以稍歇。" />
<ThemeBrandMark size={40} />
```

`ThemeScene` 仅在 `hollow` 显示；默认主题不带游戏场景。`ThemeBrandMark` 是用户批准的应用标识，作为已有文字品牌旁的装饰图标。持久主题值与 theme-only 保存操作不变。默认夜间 `crystal`、丝之歌 `silk` 继续兼容既有表现，未按 S1-r3 深化。
