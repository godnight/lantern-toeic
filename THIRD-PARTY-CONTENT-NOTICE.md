# 第三方学习内容与素材声明索引

范围：本地许可补齐草稿，仅整理ETS外链、游戏主题、英汉词典和NGSL/TSL词表四类既有证据。不是全部软件依赖许可证清单，不新增任何素材授权，也不代表准许公开发行。

## 代码与项目原创文本

根目录 `LICENSE` 与 `LICENSE-CONTENT.md` 是原项目 `lantern-site` 的逐字节副本。代码许可与内容、数据、图片、音频权利分别适用；原创内容许可仅在贡献者拥有权利范围内适用。AI辅助生成或编写本身不能授予第三方角色、商标、原文或声音的权利。新批次仍以自己的作者、来源版本、许可和准入记录为准，不因复制根许可证而扩大范围。

`docs/CONTENT_SOURCES.md` 与 `docs/CONTENT_RESOURCE_EVIDENCE.md` 是2026-09-07历史来源说明原件，用于修复既有引用。其数量、接入状态和条款核验日期均属历史；当前候选数量与功能看本轮CANDIDATE/QA交接。本次没有重新访问上游条款。

## 84,979条通用英汉词典

实际文件为 `public/dictionaries/zh-en-63cf606ec4d0.json`；来源与加工记录见 `content/dictionary-metadata.json`，完整已有署名见 `public/dictionaries/NOTICE.txt`。原文署名中文维基词典贡献者；结构化提取署名Tatu Ylönen、Wiktextract/Kaikki.org；筛选、格式整理与繁简转换署名微光托业。本衍生数据本地声明为CC BY-SA 4.0，不能改标为项目原创CC BY或软件MIT。

- 原站：https://zh.wiktionary.org/
- 逐词来源/编辑历史、输入与成品SHA、裁剪及转换说明：保留在既有NOTICE和metadata。
- 许可：https://creativecommons.org/licenses/by-sa/4.0/ ，全文：https://creativecommons.org/licenses/by-sa/4.0/legalcode 。

## NGSL / TSL及聚合成员表

已有完整声明在 `content/wordlists/NOTICE.md` 和 `content/wordlists/source-metadata.json`。NGSL 1.2及补充词署名Charles Browne、Brent Culligan、Joseph Phillips；TSL 1.2署名Charles Browne、Brent Culligan。

- NGSL来源：https://www.newgeneralservicelist.com/new-general-service-list
- TSL来源：https://www.newgeneralservicelist.com/toeic-service-list
- 本地声明许可：CC BY-SA 4.0，上述许可与全文链接同样适用。
- 加工：CSV解析JSON、规范化词头、去重与成员归并；`merged-memberships.json` 和 `wordbooks.json` 保持各自源版本与声明。此成员数据许可不能被原创释义、例句的许可覆盖。原rawCSV未作为当前运行时文件附带。

查词页面已有词典与两词表的署名、原站及许可链接，本次不重复复制整份NOTICE、不改UI或数据。

## ETS / IIBC外链

`content/resources.json` 与 `content/resources-v2.ts` 的官方资源仍为原站页面外链；既有目录声明 `link_only`、`rehostApproved:false`。ETS题目、PDF、图片、音频及商标不因软件/原创内容许可证取得使用许可。本次没有取得或补写ETS授权。内置题目作者原创声明与技术生成音频记录不等于ETS许可，也不是对所有题目进行版权相似性比对的证明。

## 游戏主题、角色与图标

`public/phase2-theme/SOURCES.md` 明确用户只批准本地实现；该批准不意味着游戏角色、同人源图或图标具有公开发行或源码再分发许可。`art/themes.json` 与相关来源清单明确用户提供AI同人素材、底层游戏角色权利仍归权利人、不是CC BY 4.0。

当前角色图标、12个场景变体、JPG品牌参考图、原生图标，以及包内旧同人主题/地图资产，不受根内容CC BY声明覆盖。未见覆盖本App再分发的游戏权利人授权证据。保留当前本地draft，公开版本由用户选择替换/去除这些特定素材，或提供覆盖具体用途的授权后再核；本次不删除或改主题。

两份旧 `public/art-packs/*-originals-v0.2.3.zip` 附有“项目拥有权利范围内CC BY4、无官方角色/截图”声明，属于另套环境图；不能仅因文件名判为当前角色素材，也不能用该声明为新角色图扩权。逐项候选及替代选项见独立交接 `GAME-ASSET-OPTIONS.md`，详细52项指纹复用上一轮预检，不另复制素材。
