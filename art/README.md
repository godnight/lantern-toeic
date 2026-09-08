# LANTERN 主题素材库

美术版本0.2.0，与应用版本分别管理。现有8幅原创交付图、19条已确认来源的参考入口、1条待核验候选。

- [空洞氛围：深蓝圣巢](themes/hollow-knight/README.md)
- [丝歌氛围：绯红丝歌](themes/silksong/README.md)
- [主题配置与哈希](themes.json)
- [官方素材目录与下载入口](official/README.md)：仅来源元数据；未复制原图。
- [手机竖图生成记录](portrait-generation-2026-09-08.json)：完整prompt、实际像素与来源。

## 实际素材包

[深蓝原创包](../public/art-packs/hollow-originals-v0.2.3.zip) · [绯红原创包](../public/art-packs/silk-originals-v0.2.3.zip)。每包含当前横/竖图、manifest与README；图片保持原始像素，以WebP quality94保存。全部8幅历史与当前素材均在public/images及themes.json登记。

官方游戏图和第三方二创均不进入应用包。CC BY 4.0只覆盖项目贡献者拥有的权利，不保证AI输出的排他版权。题库文本、美术和外部来源分别管理。

素材改动须更新真实尺寸、SHA-256、生成说明、主题版本及下载包。执行npm run validate:art；新增图还须实际解码检查并完成Web/窄屏视觉验收。
